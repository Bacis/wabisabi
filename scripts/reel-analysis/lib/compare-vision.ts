import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

export type ComparisonIssue = {
  property: string;
  expected: string;
  actual: string;
  fix: string;
};

export type ComparisonResult = {
  matchScore: number;
  issues: ComparisonIssue[];
};

export type FrameComparison = {
  frameIndex: number;
  frameSec: number;
  result: ComparisonResult;
};

const COMPARE_SYSTEM = `You are a caption STYLE comparison expert. You compare the visual STYLING of caption overlays between two frames.

- IMAGE 1 (REFERENCE): The target caption style we want to replicate
- IMAGE 2 (RENDERED): Our current render attempt on a DIFFERENT video

IMPORTANT: The two frames show DIFFERENT videos with DIFFERENT text content. This is expected.
IGNORE the actual words, the video content, and whether the text says the same thing.
ONLY compare the VISUAL STYLE of the caption text overlays:

Score based on these style properties ONLY:
- font.family: Typeface similarity (serif vs sans-serif, geometric vs humanist, specific font)
- font.weight: Boldness/thickness of strokes
- font.size: Size of text relative to the frame dimensions
- color.fill: Main text color (exact hex)
- color.emphasisFill: Color used for highlighted/emphasis words (exact hex). Are colored words present?
- color.stroke: Outline/stroke presence and color
- color.shadow: Any text shadow or glow effects
- color.gradient: Any gradient effects on text
- layout.position: Vertical position on screen (top/middle/bottom, approximate %)
- layout.align: Horizontal alignment (left/center/right)
- layout.spacing: Gaps between words, line height, overall density
- layout.wordsPerLine: Typical number of words visible per line
- sizing.emphasisRatio: Are some words dramatically bigger? What's the ratio?
- sizing.fillerRatio: Are small connector words (a, the, is) visually smaller?
- textTransform: Case patterns (all uppercase? mixed? lowercase? emphasis words uppercase?)
- overall.feel: Clean/minimal vs dramatic/heavy, modern vs classic

Return ONLY valid JSON:
{
  "matchScore": <0-100 style similarity, ignoring text content differences>,
  "issues": [
    {
      "property": "<style property>",
      "expected": "<what the reference style shows>",
      "actual": "<what the render style shows>",
      "fix": "<specific StyleSpec change needed>"
    }
  ]
}

Be EXTREMELY precise with colors — use exact hex values. Be specific about sizes — use ratios. Focus ONLY on style, never on text content.`;

export async function compareFrames(
  referencePath: string,
  renderedPath: string,
  frameContext: string,
): Promise<ComparisonResult> {
  const client = new Anthropic();

  const refData = readFileSync(referencePath).toString('base64');
  const rendData = readFileSync(renderedPath).toString('base64');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: COMPARE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `REFERENCE frame (${frameContext}):` },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: refData },
          },
          { type: 'text', text: 'OUR RENDERED frame:' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: rendData },
          },
          {
            type: 'text',
            text: 'Compare these two frames. Return the JSON comparison object. Every visual difference matters.',
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude Vision');
  }

  let jsonStr = extractJson(textBlock.text);
  return JSON.parse(jsonStr) as ComparisonResult;
}

/**
 * Send ALL comparison pairs + the current StyleSpec to Claude and ask it
 * to produce a corrected StyleSpec + list of template code changes needed.
 */
export async function generateFixes(
  comparisons: FrameComparison[],
  currentStyleSpec: any,
  currentTemplateCode: string,
): Promise<{
  updatedStyleSpec: any;
  templateChanges: string[];
  reasoning: string;
}> {
  const client = new Anthropic();

  const issuesSummary = comparisons
    .flatMap((c) =>
      c.result.issues.map(
        (issue) =>
          `Frame ${c.frameIndex} (${c.frameSec}s): [${issue.property}] expected="${issue.expected}" actual="${issue.actual}" fix="${issue.fix}"`,
      ),
    )
    .join('\n');

  const avgScore =
    comparisons.reduce((sum, c) => sum + c.result.matchScore, 0) /
    comparisons.length;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are an expert at tuning Remotion caption templates. You receive visual comparison feedback and must produce an updated StyleSpec JSON that fixes the identified issues.

The StyleSpec schema supports these fields:
- font: { family, weight, size, letterSpacing, textTransform }
- color: { fill, stroke, strokeWidth, emphasisFill (string or string[]), background, shadow: { color, blurPx, offsetX, offsetY }, fillGradient: { type, angle, stops: [{ pos, color }] } }
- layout: { position ("top"|"middle"|"bottom"), safeMargin (0-0.5), maxWordsPerLine, align ("left"|"center"|"right"), padding: { x, y }, borderRadius, gapRatio }
- animation: { durationMs, scaleFrom (0-1, 1=no scale anim), tailMs, spring: { damping, stiffness, mass } }
- reel: { — ALL visual behaviors are tunable here:
    emphasisSizeMultiplier (1.0 = same size as base, 3.0 = 3x bigger),
    fillerSizeMultiplier (1.0 = same size, 0.5 = half size),
    emphasisTextTransform ("uppercase"|"lowercase"|"none"),
    fillerTextTransform ("uppercase"|"lowercase"|"none"),
    mediumTextTransform ("uppercase"|"lowercase"|"none"),
    emphasisLineBreak (true = emphasis word gets its own line),
    emphasisWeight (font weight for emphasis words, e.g. 900),
    wordReveal ("all" = show whole chunk at once, "progressive" = words appear as spoken),
    inferEmphasis (true = auto-detect emphasis words if not in plan),
    columnGapRatio (gap between words as ratio of font size),
    rowGapRatio (gap between lines as ratio of font size),
    maxWidthPercent (max width of text container, default 90),
    paddingPercent (horizontal padding, default 6)
  }

IMPORTANT: Every visual difference can be fixed through these StyleSpec fields. The template reads ALL behavior from the spec. Focus on precise values.

Return ONLY valid JSON:
{
  "updatedStyleSpec": { ...complete StyleSpec with ALL fields including reel.* },
  "templateChanges": [],
  "reasoning": "brief explanation of changes made"
}`,
    messages: [
      {
        role: 'user',
        content: `Current average match score: ${avgScore.toFixed(1)}/100

Current StyleSpec:
${JSON.stringify(currentStyleSpec, null, 2)}

Current template code (ReelClone.tsx):
${currentTemplateCode}

Issues found across ${comparisons.length} comparison frames:
${issuesSummary}

Produce an updated StyleSpec that fixes these issues. Be precise with colors, sizes, and positioning.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response');
  }

  let jsonStr = extractJson(textBlock.text);
  return JSON.parse(jsonStr);
}

/** Extract JSON from a response that might have surrounding text */
function extractJson(text: string): string {
  let s = text.trim();
  // Strip markdown fences
  if (s.includes('```')) {
    const match = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match) return match[1].trim();
  }
  // If it starts with {, try as-is
  if (s.startsWith('{')) return s;
  // Find first { and last }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  throw new Error(`No JSON found in response: ${s.slice(0, 100)}...`);
}
