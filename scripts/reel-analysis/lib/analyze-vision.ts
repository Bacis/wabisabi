import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { VideoMeta } from './extract-frames.js';

const SYSTEM_PROMPT = `You are a design spec extraction expert. You analyze sequences of video frames showing caption/subtitle overlays and produce precise, structured design specifications.

You will receive a sequence of frames from a video showing captions/subtitles. Each frame represents a distinct visual state (frames that looked identical have been removed).

Analyze the caption styling across ALL frames and output a single JSON object describing the complete design spec.

IMPORTANT:
- For colors, provide exact hex values (#rrggbb or #rrggbbaa)
- For font size, estimate in pixels assuming the frame is 1080px wide
- For position, express as a fraction of frame height (0 = top, 1 = bottom)
- Study how text changes between frames to infer the animation pattern
- Look at which words are highlighted/colored differently — those are "emphasis" words
- Pay attention to text shadows, outlines/strokes, background boxes, gradients

Output ONLY valid JSON matching this structure (no markdown, no explanation):
{
  "description": "human-readable 1-2 sentence description of the style",
  "font": {
    "family": "closest Google Font name (e.g. Inter, Montserrat, Poppins, Oswald, Bebas Neue)",
    "weight": 800,
    "size": 72,
    "letterSpacing": 0,
    "textTransform": "uppercase | lowercase | none"
  },
  "color": {
    "fill": "#ffffff",
    "stroke": "#000000",
    "strokeWidth": 8,
    "emphasisFill": "#ffe14b",
    "background": null,
    "shadow": null | { "color": "#000000cc", "blurPx": 4, "offsetX": 0, "offsetY": 2 },
    "fillGradient": null | { "type": "linear", "angle": 90, "stops": [{"pos": 0, "color": "#fff"}, {"pos": 1, "color": "#000"}] }
  },
  "layout": {
    "position": "top | middle | bottom",
    "positionFraction": 0.78,
    "safeMargin": 0.15,
    "maxWordsPerLine": 4,
    "align": "left | center | right",
    "padding": { "x": 24, "y": 12 },
    "borderRadius": 16,
    "gapRatio": 0.25
  },
  "animation": {
    "preset": "pop | fade | karaoke | typewriter | slide",
    "durationMs": 120,
    "emphasisScale": 1.15,
    "scaleFrom": 0.6,
    "activeBoost": 1.06,
    "tailMs": 200
  },
  "customElements": [
    "description of any visual element that doesn't fit the above schema"
  ],
  "frameNotes": [
    "per-frame observations that informed your analysis"
  ]
}`;

export async function analyzeWithVision(
  uniqueFrames: string[],
  meta: VideoMeta,
  runDir: string,
): Promise<Record<string, any>> {
  const client = new Anthropic();

  // Cap at 20 frames — sample evenly if more
  const MAX_FRAMES = 20;
  let frames = uniqueFrames;
  if (frames.length > MAX_FRAMES) {
    const step = frames.length / MAX_FRAMES;
    frames = Array.from({ length: MAX_FRAMES }, (_, i) => uniqueFrames[Math.floor(i * step)]);
    console.log(`  Sampled ${MAX_FRAMES} of ${uniqueFrames.length} unique frames`);
  }

  // Build image content blocks
  const imageBlocks: Anthropic.Messages.ContentBlockParam[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frameData = readFileSync(frames[i]);
    const base64 = frameData.toString('base64');

    imageBlocks.push({
      type: 'text',
      text: `Frame ${i + 1} of ${frames.length}:`,
    });
    imageBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: base64,
      },
    });
  }

  imageBlocks.push({
    type: 'text',
    text: `Video metadata: ${meta.width}x${meta.height}, ${meta.fps}fps, ${meta.durationSec.toFixed(1)}s duration.

Analyze all ${frames.length} frames above and extract the complete caption design specification. Output ONLY the JSON object.`,
  });

  console.log(`  Sending ${frames.length} frames to Claude Vision...`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: imageBlocks,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude Vision');
  }

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  }

  const recipe = JSON.parse(jsonStr);

  // Save recipe
  const recipePath = join(runDir, 'recipe.json');
  writeFileSync(recipePath, JSON.stringify(recipe, null, 2));
  console.log(`  Recipe saved: ${recipePath}`);

  return recipe;
}
