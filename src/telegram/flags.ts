// Telegram caption flag parser.
//
// Users send `@bot [flags] [creative brief]` in a caption. This module
// extracts flags, validates them enough to fail fast on obvious mistakes,
// and produces a `Record<string, string>` that the bot appends to the
// outbound `POST /productions` FormData. Every field we set maps to an
// input the API already accepts — we do not introduce new server-side
// schema here.
//
// Precedence when both `--style <json>` and shortcut flags (--position,
// --animation, --color, --words) touch the same sub-field: shortcuts
// win. This matches the principle that the more specific/explicit thing
// overrides the generic JSON blob.
//
// `--style` is a "tail consumer": everything after it on the caption is
// parsed as JSON, so users don't have to worry about escaping spaces
// inside the JSON. Put other flags *before* `--style`.
import { PRESETS, mergeStyleSpec } from '../shared/presets.js';

// ---------- Voice aliases ----------------------------------------------------
//
// ElevenLabs voice IDs are opaque hex strings. These aliases resolve to the
// well-known public default voice IDs that have been constant since the
// early ElevenLabs API (and are the same across every account). Unknown
// values fall through unchanged, so users can paste any raw voice ID.
//
// To extend: add an entry here. IDs can be found in the ElevenLabs "Voice
// Library" UI or via `GET https://api.elevenlabs.io/v1/voices`.
export const VOICE_ALIASES: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  adam: 'pNInz6obpgDQGcFmaJgB',
  antoni: 'ErXwobaYiN019PkySvjV',
  josh: 'TxGEqnHWrfWFTfGW9XjX',
  arnold: 'VR6AewLTigWG4xSOukaG',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
};

// Small named-color table for `--color` so users don't have to type hex
// for the common emphasis colors already used by presets.
const COLOR_NAMES: Record<string, string> = {
  yellow: '#ffe14b',
  pink: '#ff3366',
  white: '#ffffff',
  cyan: '#00eaff',
  magenta: '#ff2bd6',
  gold: '#ffe14b',
  coral: '#ff6b6b',
  amber: '#ffb703',
  mint: '#06d6a0',
};

// Mirror of the color regex used by the server-side Zod schema at
// src/shared/styleSpec.ts:11-13 — keep in sync if that tightens.
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const ANIMATION_VALUES = ['pop', 'fade', 'karaoke', 'typewriter', 'slide'] as const;
const POSITION_VALUES = ['top', 'middle', 'bottom'] as const;

// ---------- Types ------------------------------------------------------------

export type ParsedCaption = {
  /** Free-form creative brief (everything that wasn't a flag or flag-value). */
  prompt: string;
  /** Ready-to-append multipart fields for POST /productions. */
  fields: Record<string, string>;
  /** User asked for help — the bot should reply with HELP_TEXT and not submit. */
  help: boolean;
  /** Human-readable parse errors; non-empty means the bot should reject. */
  errors: string[];
};

// Internal accumulator for shortcut-driven styleSpec overrides.
type StyleDelta = {
  layout?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  color?: Record<string, unknown>;
  font?: Record<string, unknown>;
  splitScreen?: Record<string, unknown>;
};

// ---------- Parser -----------------------------------------------------------

export function parseCaption(raw: string): ParsedCaption {
  const errors: string[] = [];
  const fields: Record<string, string> = {};
  const promptParts: string[] = [];
  const styleDelta: StyleDelta = {};
  let stylePayload: Record<string, unknown> | null = null;
  let help = false;

  const tokens = raw.split(/\s+/).filter((t) => t.length > 0);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const lower = tok.toLowerCase();

    // ---- Boolean flags
    if (lower === '--help' || lower === '-h' || lower === '--h') {
      help = true;
      continue;
    }

    if (lower === '--brainrot') {
      styleDelta.splitScreen = { ...(styleDelta.splitScreen ?? {}), brainRot: true };
      continue;
    }

    // ---- Tail consumer: everything after --style is JSON.
    if (lower === '--style') {
      const rest = tokens.slice(i + 1).join(' ').trim();
      if (!rest) {
        errors.push('`--style` needs a JSON value.');
      } else {
        try {
          const parsed = JSON.parse(rest);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            stylePayload = parsed as Record<string, unknown>;
          } else {
            errors.push('`--style` must be a JSON object, e.g. `{"color":{"emphasisFill":"#ff3366"}}`.');
          }
        } catch (err) {
          errors.push(`\`--style\` is not valid JSON: ${(err as Error).message}`);
        }
      }
      i = tokens.length;
      break;
    }

    // ---- Value flags: need the next token.
    if (isKnownValueFlag(lower)) {
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith('--')) {
        errors.push(`\`${tok}\` needs a value.`);
        continue;
      }
      applyValueFlag(lower, next, { fields, styleDelta, errors });
      i++;
      continue;
    }

    // ---- Unknown flag → surface it rather than silently swallowing.
    if (tok.startsWith('--') && tok.length > 2) {
      errors.push(`Unknown flag \`${tok}\`. Try \`/help\` to see available flags.`);
      continue;
    }

    // ---- Free text → part of the creative brief.
    promptParts.push(tok);
  }

  // Merge --style JSON with shortcut-driven deltas. Shortcuts win via the
  // two-level merge at the end (override second arg overrides first arg).
  const hasShortcuts = Boolean(
    styleDelta.layout ||
      styleDelta.animation ||
      styleDelta.color ||
      styleDelta.font ||
      styleDelta.splitScreen,
  );
  if (stylePayload || hasShortcuts) {
    const base = stylePayload ?? {};
    const merged = hasShortcuts
      ? mergeStyleSpec(base, styleDelta as Record<string, unknown>)
      : base;
    fields.styleSpec = JSON.stringify(merged);
  }

  const prompt = promptParts.join(' ').trim();
  return { prompt, fields, help, errors };
}

// ---------- Per-flag handlers ------------------------------------------------

function isKnownValueFlag(lower: string): boolean {
  return (
    lower === '--voice' ||
    lower === '--preset' ||
    lower === '--length' ||
    lower === '--len' ||
    lower === '--cap' ||
    lower === '--duration' ||
    lower === '--position' ||
    lower === '--animation' ||
    lower === '--color' ||
    lower === '--words'
  );
}

type ApplyCtx = {
  fields: Record<string, string>;
  styleDelta: StyleDelta;
  errors: string[];
};

function applyValueFlag(flag: string, rawValue: string, ctx: ApplyCtx): void {
  const v = rawValue.trim();
  const { fields, styleDelta, errors } = ctx;

  switch (flag) {
    case '--voice': {
      const key = v.toLowerCase();
      fields.voiceId = VOICE_ALIASES[key] ?? v;
      return;
    }

    case '--preset': {
      if (!Object.prototype.hasOwnProperty.call(PRESETS, v)) {
        errors.push(
          `Unknown preset \`${v}\`. Valid: ${Object.keys(PRESETS).map((k) => `\`${k}\``).join(', ')}.`,
        );
        return;
      }
      fields.presetId = v;
      return;
    }

    case '--length':
    case '--len':
    case '--cap':
    case '--duration': {
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 20 || n > 60) {
        errors.push(`\`${flag}\` must be an integer between 20 and 60 (got \`${v}\`).`);
        return;
      }
      fields.capSeconds = String(n);
      return;
    }

    case '--position': {
      if (!(POSITION_VALUES as readonly string[]).includes(v)) {
        errors.push(`\`--position\` must be one of: ${POSITION_VALUES.join(', ')}.`);
        return;
      }
      styleDelta.layout = { ...(styleDelta.layout ?? {}), position: v };
      return;
    }

    case '--animation': {
      if (!(ANIMATION_VALUES as readonly string[]).includes(v)) {
        errors.push(`\`--animation\` must be one of: ${ANIMATION_VALUES.join(', ')}.`);
        return;
      }
      styleDelta.animation = { ...(styleDelta.animation ?? {}), preset: v };
      return;
    }

    case '--color': {
      const resolved = resolveColor(v);
      if (!resolved) {
        errors.push(
          `\`--color\` must be a hex color like \`#ff3366\` or a named color (${Object.keys(COLOR_NAMES).join(', ')}).`,
        );
        return;
      }
      styleDelta.color = { ...(styleDelta.color ?? {}), emphasisFill: resolved };
      return;
    }

    case '--words': {
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 10) {
        errors.push(`\`--words\` must be an integer between 1 and 10 (got \`${v}\`).`);
        return;
      }
      styleDelta.layout = { ...(styleDelta.layout ?? {}), maxWordsPerLine: n };
      return;
    }
  }
}

function resolveColor(v: string): string | null {
  const named = COLOR_NAMES[v.toLowerCase()];
  if (named) return named;
  return HEX_COLOR_RE.test(v) ? v : null;
}

// ---------- Help text --------------------------------------------------------

function buildHelpText(): string {
  const presetLines = Object.values(PRESETS)
    .map((p) => `  • \`${p.id}\` — ${p.name}`)
    .join('\n');

  const voiceLines = Object.keys(VOICE_ALIASES)
    .map((name) => `  • \`${name}\``)
    .join('\n');

  return `🎛 *Bot controls*

Send a video/image with caption \`@botname <flags> <creative brief>\`. All flags are optional — with no flags, the caption is used as a story prompt.

*Output length*
  \`--length N\` — target duration in seconds, 20–60 (default 45)
  aliases: \`--len\`, \`--cap\`, \`--duration\`

*Voice (ElevenLabs)*
  \`--voice <name-or-id>\` — short alias or raw ElevenLabs voice ID
  Known aliases:
${voiceLines}

*Caption preset*
  \`--preset <id>\` — bundled visual look
${presetLines}

*Caption shortcuts* (merge on top of the preset)
  \`--position top|middle|bottom\`
  \`--animation pop|fade|karaoke|typewriter|slide\`
  \`--color <#hex|${Object.keys(COLOR_NAMES).join('|')}>\` — emphasis/pop color
  \`--words N\` — max words per chunk, 1–10

*Layout*
  \`--brainrot\` — split screen: speaker top, random brain-rot bottom, captions in the middle

*Advanced*
  \`--style {...}\` — raw styleSpec JSON. Must be the *last* flag; everything after is treated as JSON.

*Creative brief*
  Any text that isn't a flag becomes the story prompt for the AI orchestrator.

*Examples*
  \`@bot sunset over the lake\`
  \`@bot --voice rachel --preset story-sunset --length 30 hopeful coffee shop story\`
  \`@bot --preset neon --position top --color cyan skateboard tricks\`
  \`@bot --words 3 --animation karaoke --style {"color":{"emphasisFill":"#ff00aa"}}\`
`;
}

export const HELP_TEXT = buildHelpText();
