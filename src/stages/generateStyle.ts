import { z } from 'zod';
import { StyleSpecSchema, type StyleSpec } from '../shared/styleSpec.js';
import type { TemplateId } from '../shared/presets.js';

// Natural-language → StyleSpec generator. The user types a description
// ("make it look like a neon sign with pink emphasis #ff3366") and Claude
// translates that into a StyleSpec our template understands. Prompt caching
// is enabled on the (large, static) system prompt, so subsequent calls in
// the same ~5-minute window only pay for the short user message + the
// model's response tokens.
//
// The LLM receives the current spec as context so it can do *incremental*
// edits — "make it bigger" should only change font.size, not clobber
// everything else. If the user wants a hard reset, they pass an empty
// currentSpec.

const SYSTEM_PROMPT = `You are a caption-style editor. The user describes how they want their video captions to look; you convert that description into a StyleSpec JSON object that drives a Remotion template.

# StyleSpec schema

Every field is optional. Omit anything you're not explicitly changing.

font:
  family         string    font family name (e.g. "Inter", "Impact", "Arial", "DM Sans")
                           honor any font the user names — browser will fall back if unavailable
  weight         100-900   font weight (typical: 400 regular, 700 bold, 900 black)
  size           number    size in px (typical 40-120; small videos: 40-64; 1080p: 60-100)
  letterSpacing  number    letter spacing in px (typical -5 to 10)
  textTransform  "none" | "uppercase" | "lowercase"
  variableAxes   {wght: number, slnt: number, ...}   variable-font axes (only if user mentions)

color:
  fill           hex       main text color (default "#ffffff")
  stroke         hex       outline color (default "#000000")
  strokeWidth    number    outline width in px (default 8, range 0-24)
  emphasisFill   hex OR array of hex   color for words the LLM marked as emphasized.
                           Pass an array like ["#ff3366","#00eaff","#ffe14b"] to cycle
                           colors per chunk (each caption line gets a different color).
  background     hex       optional background box behind the text
  shadow:
    color        hex       shadow color (use hex8 for alpha, e.g. "#000000cc")
    blurPx       number    blur radius; large values = glow
    offsetX      number    horizontal offset
    offsetY      number    vertical offset (positive = down)
  fillGradient:            gradient fill on non-emphasis words
    type         "linear"
    angle        number    degrees (0 = left-to-right, 90 = top-to-bottom)
    stops        array of {pos: 0-1, color: hex}   at least 2 stops

layout:
  position       "top" | "middle" | "bottom"   (default "bottom")
  safeMargin     0-0.5     fraction of frame height kept clear from edge (default 0.15)
  maxWordsPerLine  integer (default 4, typical 2-5)
  align          "left" | "center" | "right"
  padding        {x: number, y: number}   inner padding of the background box
  borderRadius   number    corner radius of the background box (default 16)
  gapRatio       number    space between words as multiple of font.size (default 0.25)

animation:
  preset         "pop" | "fade" | "karaoke" | "typewriter" | "slide"
                 - pop: springy scale-in (default, most common)
                 - fade: smooth opacity cross-fade per chunk
                 - karaoke: words light up as spoken, classic sing-along
                 - typewriter: words appear one at a time
                 - slide: words translate up into place
  durationMs     number    animation duration (default 120, range 50-600)
  emphasisScale  1-3       scale multiplier for emphasized words (default 1.15)
  scaleFrom      0-1       starting scale for pop/slide (default 0.6)
  activeBoost    1-2       extra scale on currently-spoken word (default 1.06)
  tailMs         number    how long chunks linger after last word (default 200)
  spring         {damping, stiffness, mass}   physics (default 12/200/0.6)

templateId (top-level, sibling to styleSpec):
  "pop-words"      standard multi-word caption lines (default)
  "single-word"    one huge word at a time, MrBeast-style (for "big word", "hyper", "bold" requests)
  "three-effects"  experimental WebGL template — words pop in with deterministic particle bursts and slight 3D rotation; choose for "particles", "burst", "explosion", "3D", "WebGL", "three.js", "fancy", "experimental" requests
  "kinetic-burst"  maximum-kinetic WebGL template — words swoop in along bezier arcs with motion-blur ghost trails, spring-overshoot lock, glowing emphasis halos, orbital particle rings, and a twinkling star field. Choose for "kinetic", "cinematic", "showcase", "swoop", "trails", "glow", "neon", "epic", "premium", "high-energy", "intro", "title sequence" requests.

# Rules

1. OUTPUT JSON ONLY. No prose, no markdown code fences, no explanation outside the "notes" field.
2. If the user pastes specific hex colors or font names, use EXACTLY those values — don't substitute.
3. For incremental edits ("make it bigger", "change the color to green"), only include the fields you're changing. Preserve the rest by omission.
4. For full re-styles ("make it look like a horror movie"), include every field needed to achieve the look; unspecified fields use schema defaults.
5. Look names to rules of thumb:
   - "neon" / "glow" → color.shadow with large blurPx, no offset, same hue as the text
   - "karaoke" / "sing-along" → animation.preset: "karaoke"
   - "MrBeast" / "big word" / "attention-grabbing one word" → templateId: "single-word"
   - "particles" / "burst" / "explosion" / "3D" / "WebGL" / "fancy" / "experimental" → templateId: "three-effects"
   - "kinetic" / "cinematic" / "swoop" / "trails" / "title sequence" / "premium" / "epic" / "showcase" → templateId: "kinetic-burst"
   - "minimal" / "clean" / "understated" → lower weight (400-600), no uppercase, thin stroke, fade preset
   - "retro" / "vintage" → serif font, warm colors, lower saturation
   - "cyberpunk" / "sci-fi" → cool colors, palette of cyan/magenta, glow shadow
   - "bold" / "aggressive" / "hype" → weight 900, uppercase, larger emphasisScale, fast duration
6. When the user names multiple colors for emphasis, use a palette array for emphasisFill.
7. notes is a single short sentence describing what you did (max 100 chars). It's shown to the user.

# Output format

{
  "templateId": "pop-words" | "single-word" | "three-effects" | "kinetic-burst"    (optional — omit to keep current),
  "styleSpec": { ... },                         (required — just the fields you're changing)
  "notes": "short human-readable summary"       (required)
}`;

// The LLM's response shape, before we pass it through the canonical
// StyleSpec schema. Permissive because the nested shape is validated
// downstream by StyleSpecSchema.safeParse.
const llmResponseSchema = z.object({
  templateId: z.enum(['pop-words', 'single-word', 'three-effects', 'kinetic-burst']).optional(),
  styleSpec: z.record(z.string(), z.any()),
  notes: z.string().optional(),
});

export type GenerateStyleArgs = {
  query: string;
  currentSpec?: Record<string, unknown>;
  currentTemplateId?: string;
};

export type GenerateStyleResult = {
  styleSpec: StyleSpec;
  templateId: TemplateId;
  notes: string;
};

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

export async function generateStyle(args: GenerateStyleArgs): Promise<GenerateStyleResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to .env to enable style generation');
  }

  // Lazy import so the API boots even when the SDK isn't installed.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const currentSpecJson = JSON.stringify(args.currentSpec ?? {}, null, 2);
  const userMessage = `Current templateId: ${args.currentTemplateId ?? 'pop-words'}

Current styleSpec:
${currentSpecJson}

User query: ${args.query}

Output JSON only. No prose, no markdown fences.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = response.content[0];
  const text = block && block.type === 'text' ? block.text : '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (err) {
    throw new Error(
      `LLM returned non-JSON response: ${(err as Error).message}\n--- response: ---\n${text.slice(0, 400)}`,
    );
  }

  const outer = llmResponseSchema.safeParse(parsed);
  if (!outer.success) {
    throw new Error(`LLM response is missing required fields: ${outer.error.message}`);
  }

  // For incremental edits the LLM returns only the changed fields. Merge
  // them on top of the current spec before running the canonical schema
  // so required defaults fall through untouched.
  const merged = deepMergeAny(args.currentSpec ?? {}, outer.data.styleSpec);
  const validated = StyleSpecSchema.safeParse(merged);
  if (!validated.success) {
    throw new Error(
      `merged spec failed StyleSpec validation: ${JSON.stringify(validated.error.flatten())}`,
    );
  }

  const ms = Date.now() - start;
  const cached = (response.usage as unknown as { cache_read_input_tokens?: number } | undefined)
    ?.cache_read_input_tokens;
  console.log(
    `generateStyle: ${ms}ms ${cached ? `(cache hit: ${cached} tokens)` : '(cache miss)'}`,
  );

  return {
    styleSpec: validated.data,
    templateId:
      outer.data.templateId ??
      ((args.currentTemplateId as TemplateId | undefined) ?? 'pop-words'),
    notes: outer.data.notes ?? '',
  };
}

// Two-level deep merge identical in shape to the one in src/shared/presets.ts
// — duplicated here because generateStyle is a separate stage and I don't
// want to pull preset helpers into this module's surface. Objects deep-
// merge; arrays and primitives replace wholesale (so an emphasisFill
// palette replaces the previous one cleanly).
function deepMergeAny(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const b = base[key];
    const o = override[key];
    if (
      b &&
      typeof b === 'object' &&
      !Array.isArray(b) &&
      o &&
      typeof o === 'object' &&
      !Array.isArray(o)
    ) {
      out[key] = { ...(b as object), ...(o as object) };
    } else if (o !== undefined) {
      out[key] = o;
    }
  }
  return out;
}
