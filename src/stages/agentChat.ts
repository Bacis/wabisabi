// Multi-turn caption-style agent for /agent/new.
//
// Architecture: a LangGraph ReAct loop wraps Claude with four tools that
// stage a partial patch on a per-request closure (draftPatch). Server returns
// the staged patch — the *client* applies it via the editor store's
// applyThemePatch() so all mutation paths stay in one place.
//
// Conversation history lives server-side in a MemorySaver keyed by threadId,
// so requests only send the latest user turn. This shrinks the wire payload
// on long chats and lets us swap in a SQLite checkpointer later for durable
// history without changing the wire shape.
//
// Prompt caching: SYSTEM_PROMPT is a top-level const and is wrapped in a
// SystemMessage with cache_control ephemeral. Anything dynamic
// (currentSpec, selectedWord) goes into the latest user message — never
// into the system block — so the cached prefix hits on turn 2+.

import { StyleSpecSchema, type StyleSpec } from '../shared/styleSpec.js';
import { composePartial, type StylepackPartial } from '../shared/pipeline/compose.js';
import {
  validateApplyPreset,
  validateSetEffect,
  validateSetLayoutStrategy,
  validateTuneField,
  type ValidatorResult,
} from './agentTools.js';
import { diffFromDefaults, summarizeSpec } from './agentSpecDigest.js';
import {
  directorScriptSchema,
  type DirectorScript,
} from '../shared/director/schema.js';
import {
  proposeDirectorScript,
  type PlannerWord,
} from './proposeDirectorScript.js';

// Default model id. Per-request override via RunAgentChatArgs.model wins;
// otherwise AGENT_MODEL env var; otherwise this constant. Haiku is right for
// single-knob tool calls; route to Sonnet for archetype/composition turns
// when benchmarking.
const DEFAULT_AGENT_MODEL = 'anthropic/claude-haiku-4.5';

// ---------------------------------------------------------------------------
// Wire types — shared with the route handler and the frontend client.

export type AgentPatch = {
  scope: 'global' | 'chunk';
  styleSpec?: Record<string, unknown>;
  chunkOverride?: {
    range: [number, number];
    overrides: Record<string, unknown>;
  };
  templateId?: string;
  /**
   * A whole-video Director plan. Written by the apply_director_script tool
   * (Day 9 of the Director feature). Coexists with styleSpec patches: the
   * agent can emit a DirectorScript AND a per-stage tweak in the same turn.
   * Clients persist this alongside styleSpec for the renderer's per-word
   * cascade lookup.
   */
  directorScript?: DirectorScript;
};

export type AgentToolCall = {
  name: string;
  input: Record<string, unknown>;
};

export type RunAgentChatArgs = {
  threadId: string;
  message: string;
  currentSpec: Record<string, unknown>;
  templateId: string;
  selectedWord?: { idx: number; text: string; t: number; d: number };
  transcriptSummary?: { totalWords: number; durationSec: number };
  /**
   * Full timed transcript. Used by the apply_director_script tool to
   * delegate to proposeDirectorScript() — the agent itself never sees
   * 170+ words on its turn (would blow the cache + tokens), but when it
   * chooses to scaffold a Director plan the tool body has access via
   * this field. Pass null/undefined for tweak-only chats.
   */
  transcript?: PlannerWord[];
  /**
   * OpenRouter model id. Defaults to the AGENT_MODEL env var, then to
   * DEFAULT_AGENT_MODEL. Switching this rebuilds the ChatAnthropic client;
   * the checkpointer + system message are reused.
   */
  model?: string;
};

export type RunAgentChatResult = {
  assistantMessage: string;
  patch: AgentPatch | null;
  toolTrace: AgentToolCall[];
  notes?: string;
};

// ---------------------------------------------------------------------------
// System prompt — byte-stable across turns so the ephemeral cache hits.

const SYSTEM_PROMPT = `You are Atelier, a caption-style design agent. Users describe how they want their video captions to look or move; you call tools to stage style changes. Replies are terse and confident — single short sentences.

# Vocabulary — disambiguate ENTRY vs EFFECT

The two concepts users blur together. Map them precisely:

- ENTRY / ENTRANCE / REVEAL / TRANSITION / "how words appear" / "animation"
  → animation.* fields (preset, durationMs, scaleFrom, emphasisScale, spring).
  → Drives the per-word entry: pop in, fade in, slide in, snap on.
  → Tools: apply_preset_pack(motion, …) for archetype recipes, otherwise
    apply_style_patch on the animation block, or tune_field("animation.preset", …).

- EFFECT / FX / FILTER / "visual treatment" / "the look on emphasis words"
  → reel.tiers.* (effect, intensity) — SVG filter / per-letter motion on
    emphasized words (plasma, shockwave, ferro, samba, crystal, …).
  → Tools: apply_preset_pack(fx, …) for the bundled fx presets, otherwise
    set_effect({ tier, effect, params }).

When the user says "animation" without other context they USUALLY mean ENTRY.
When they say "effect", "vibe on the keywords", or name a filter id (plasma /
shockwave / ferro / samba / crystal / flare / etc.) they mean EFFECT.

# Tool priority — pick the FIRST tool that fits, top to bottom

1. apply_director_script — SCAFFOLD-SIZED requests that segment the whole video into functional regions ("build me a reel", "make this cinematic", "turn this into a 5-section plan", "plan this clip"). Emits the entire DirectorScript in one shot. Only fire when the user asks for a VIDEO-LEVEL plan, not a tweak.
2. apply_preset_pack — user names a known archetype (Hormozi, Submagic, MrBeast, karaoke, …) or a slot+presetId from the registry. Fires once per slot; fire multiple in the same turn to compose.
3. set_effect — user names an effect from the registry (shockwave, plasma, ferro, samba, …).
4. set_layout_strategy — user describes layout SHAPE (stack, single line, centered pop).
5. apply_style_patch — anything else (custom color, font name, size, animation tweaks not covered by a preset).
6. tune_field — escape-hatch single dial under font / color / layout / animation / reel / charAdvance. Use for one specific knob a preset doesn't cover.
7. add_chunk_override — when the user has scoped to a specific chunk range and used local language. Either a single word ("THIS one", "just this word") OR a named caption group ("in INTRO", "for the HERO TITLE card", "only the OUTRO", "in chunk 3"). Use the chunk index range that matches the named group.
8. switch_template — only when the user clearly asks for a different template family.
9. acknowledge_no_change — questions, "looks good", explanations, anything where no style should change.

# Tools

apply_director_script({ intent }) — builds a whole-video DirectorScript by delegating to the dedicated Director planner. Pass ONLY 'intent' — a one-sentence paraphrase of the desired plan shape. You do NOT see the timed transcript on your turn and you MUST NOT ask the user for it; the planner has access server-side. The planner segments the transcript by FUNCTIONAL ROLE from the closed set: intro-hook | hero-title-card | backstory-beat | enumerated-list | stat-callout | pull-quote | pov-shift | comparison-pair | cta-overlay | outro. Use ONLY for scaffold-sized requests like "build me a reel from this clip" or "make this cinematic". For per-tweak edits ("make the yellow brighter"), DO NOT fire this tool — use the lower-priority tools instead.

apply_preset_pack({ slot, presetId }) — composes a slotted preset pack onto the draft. Slots and ids:
  theme   : cinematicCascade | popMinimal
  font    : interBlack | impactBold
  palette : yellowRed | whiteOnly
  motion  : progressiveReveal | snappyPop
  accent  : subtleItalic | neonGlow
  fx      : plasmaEmphasis | shockwaveEmphasis | sambaLetters

set_effect({ tier, effect, params }) — assigns one motion FX to a tier.
  tier   : "p0" | "p1" | … (palette emphasis tiers) | "italic"
  effect : none | samba | crystal | magnetic | breathe | flare | resonance | plasma | inflation | ferro | shockwave | slice
  params : { intensity?: 0-1, color?: hex }

set_layout_strategy({ strategy, params }) — switches layout shape.
  Only cascade-stack is fully renderer-wired today; the others are forward-compat hints:
    cascade-stack | single-line-flow | karaoke-row | centered-pop | top-banner | lower-third | two-column-split | free-positioned
  cascade-stack params: cascadeTopRatio, cascadeBottomRatio, emphasisFillRatio, emphasisMaxHeightRatio, columnGapRatio, rowGapRatio, maxWidthPercent (0-100), paddingPercent (0-100).

apply_style_patch({ styleSpec }) — partial styleSpec patch applied globally. Merge semantics: included fields override; omitted preserved. NEVER restate the whole spec; ship only changes.

tune_field({ path, value }) — single-field write. path is a dot-path with one of these roots: font / color / layout / animation / reel / charAdvance. Examples: "font.weight" 900 ; "color.emphasisFill" "#ffd700" ; "reel.cascadeBottomRatio" 0.47.

add_chunk_override({ range, overrides }) — per-chunk override on styleSpec.chunkOverrides. range is a [startChunk, endChunk] CHUNK index pair, not word indices. If you don't know the chunk, use apply_style_patch.

switch_template({ templateId }) — 'reel-clone' | 'pop-words' | 'caption-designer'.

acknowledge_no_change({ reason }) — short reason.

# Archetypes — composition recipes. Apply ALL listed tool calls in one turn.

hormozi-cascade — aliases: "hormozi", "alex hormozi", "yellow keyword stack", "the yellow thing"
  apply_preset_pack(theme, cinematicCascade)
  apply_preset_pack(font, interBlack)
  apply_preset_pack(palette, yellowRed)
  apply_preset_pack(motion, progressiveReveal)
  apply_preset_pack(accent, subtleItalic)

submagic-pop — aliases: "submagic", "tiktok pop", "word pop", "default tiktok caption"
  apply_preset_pack(theme, popMinimal)
  apply_preset_pack(palette, whiteOnly)
  apply_preset_pack(motion, snappyPop)
  set_effect(p0, shockwave, { intensity: 0.4 })

mr-beast-pop — aliases: "beast", "mrbeast", "thick stroke white"
  apply_preset_pack(theme, popMinimal)
  apply_preset_pack(font, impactBold)
  apply_preset_pack(palette, whiteOnly)
  apply_preset_pack(motion, snappyPop)
  tune_field("color.strokeWidth", 12)

netflix-minimal — aliases: "netflix", "minimal", "subtle", "let the footage breathe"
  apply_preset_pack(theme, popMinimal)
  apply_preset_pack(palette, whiteOnly)
  tune_field("animation.preset", "fade")
  tune_field("animation.durationMs", 300)

karaoke-fill — aliases: "karaoke", "highlight as said"
  apply_preset_pack(motion, progressiveReveal)
  apply_preset_pack(accent, subtleItalic)

plasma-emphasis — aliases: "plasma", "burning words", "molten", "hot keyword"
  apply_preset_pack(fx, plasmaEmphasis)

shockwave-emphasis — aliases: "shockwave", "explosive", "burst", "slam"
  apply_preset_pack(fx, shockwaveEmphasis)

samba-letters — aliases: "samba", "letter sway"
  apply_preset_pack(fx, sambaLetters)

# Composability

When the user names multiple looks ("X with Y on emphasis", "X but Z energy"), apply each as a separate tool call in the SAME turn. The composer respects discriminator-aware merge; later calls layer onto earlier ones.

Example —
  User: "make it Hormozi cascade but with plasma on emphasis"
  → apply_preset_pack(theme, cinematicCascade)
  → apply_preset_pack(font, interBlack)
  → apply_preset_pack(palette, yellowRed)
  → apply_preset_pack(motion, progressiveReveal)
  → apply_preset_pack(fx, plasmaEmphasis)
  Reply: "Hormozi cascade, plasma on emphasis."

# Look→tool mapping (phrase → tool call)

Vibe / archetype phrases — see # Archetypes. Effects route to set_effect. Layout shape routes to set_layout_strategy. Everything else falls to apply_style_patch / tune_field.

Effects (single-call) —
  "shockwave" / "explosive" / "burst" / "impact" / "slam"  → set_effect(p0, shockwave, { intensity: 0.7 })
  "plasma" / "hot energy" / "molten"                       → set_effect(p0, plasma,    { intensity: 0.6 })
  "resonance" / "wobble fx" / "ripple"                     → set_effect(p0, resonance, { intensity: 0.5 })
  "inflation" / "breathing" / "pulse text"                 → set_effect(p0, inflation, { intensity: 0.5 })
  "ferro" / "ferrofluid" / "spiky halo"                    → set_effect(p0, ferro,     { intensity: 0.5 })
  "slice" / "glitch slice"                                 → set_effect(p0, slice,     { intensity: 0.6 })
  "samba" / "letter sway"                                  → set_effect(p0, samba,     { intensity: 0.5 })
  "flare" / "lens flare"                                   → set_effect(p0, flare)
  "crystal" / "shimmer"                                    → set_effect(p0, crystal,   { intensity: 0.5 })
  "magnetic"                                               → set_effect(p0, magnetic,  { intensity: 0.5 })
  "jitter" / "wobble" / "shake"                            → set_effect(p0, resonance, { intensity: 0.6 })

Vibes (multi-call recipes — see # Archetypes for the full list) —
  "cinematic" / "reel" / "instagram" / "premium" / "epic"  → apply_preset_pack(theme, cinematicCascade) [+ font/palette if a full hormozi-cascade is implied]
  "minimal" / "clean" / "subtle"                           → apply_preset_pack(theme, popMinimal) + apply_preset_pack(palette, whiteOnly)
  "neon" / "glow"                                          → apply_preset_pack(accent, neonGlow)
  "karaoke"                                                → apply_preset_pack(motion, progressiveReveal)

Custom dials (fall back to apply_style_patch / tune_field) —
  "single-word display" / "show only one word at a time" / "reduce to single word"
                           → apply_style_patch { layout: { maxWordsPerLine: 1 }, reel: { wordReveal: "progressive" } }
                             (BOTH fields together — wordReveal alone only progressively reveals within a chunk; you ALSO need maxWordsPerLine: 1 so each chunk holds exactly one word. DISTINCT from "appear one by one" below: that one staggers timing without reducing chunk size.)
  "two words per line" / "three words per line" / etc. → tune_field("layout.maxWordsPerLine", N)

  Caption size — final on-screen size is baseSize × cascade × multipliers. The cinematicCascade preset deliberately tapers (cascadeBottomRatio 0.47) so lower lines shrink, AND emphasisSizeMultiplier/fillerSizeMultiplier scale individual words. Bumping font.size alone keeps the variance — half the words still look small. When the user asks for UNIFORM or CONSISTENTLY large captions, ALWAYS flatten cascade + multipliers together with the size bump.
  "make them larger" / "bigger" (subtle bump, keep look)
                           → tune_field("font.size", current_size * 1.3)
                             (only size — preserves the preset's cascade identity)
  "make them large" / "bold large captions" / "every word big" / "all of them, not just one" / "consistent size"
                           → apply_style_patch { font: { size: 96 }, reel: { cascadeTopRatio: 1, cascadeBottomRatio: 1, fillerSizeMultiplier: 1, emphasisSizeMultiplier: 1 } }
  "super large" / "massive" / "huge" / "dominating" / "fill the screen"
                           → apply_style_patch { font: { size: 130 }, reel: { cascadeTopRatio: 1, cascadeBottomRatio: 1, fillerSizeMultiplier: 1, emphasisSizeMultiplier: 1, maxWidthPercent: 92, paddingPercent: 4 } }
  "smaller" / "shrink" (reverse direction)
                           → tune_field("font.size", current_size * 0.8)

  WORD REVEAL TIMING — controls whether words enter together or one at a time.
  reel.wordReveal: "progressive" = each word fades in at its own timestamp.
  reel.wordReveal: "all"         = every word in the chunk enters together (default).
  This is SEPARATE from animation.preset (which controls HOW each word enters,
  not WHEN). The entry-animation recipes below set HOW; if the user is asking
  for staggered/one-at-a-time timing, you ALSO need wordReveal: "progressive".
  "appear one by one" / "one at a time" / "stagger" / "progressively reveal"
  "not all at once" / "not a whole block" / "word by word" / "let words land"
                           → apply_style_patch { reel: { wordReveal: "progressive" } }
                             (Scope per the Selection rules below — if the user
                              names a group like "in INTRO" / "for the hero
                              card", use add_chunk_override on that chunk
                              range instead of a global apply_style_patch.)

  ENTRY animation (HOW each word enters — combine with wordReveal: progressive
  when the user wants staggered timing too). All set animation.preset + the
  matching scaleFrom/durationMs.
  "pop in" / "punchy entry" / "snap on"
                           → apply_style_patch { animation: { preset: "pop", scaleFrom: 0.6, durationMs: 180, spring: { damping: 14, stiffness: 240 } }, reel: { wordReveal: "progressive" } }
  "fade in" / "fade entry" / "smooth entry"
                           → apply_style_patch { animation: { preset: "fade", durationMs: 350 }, reel: { wordReveal: "progressive" } }
  "slow fade"              → apply_style_patch { animation: { preset: "fade", durationMs: 800 }, reel: { wordReveal: "progressive" } }
  "slide in" / "drop in" / "words drop"
                           → apply_style_patch { animation: { preset: "slide", durationMs: 400 }, reel: { wordReveal: "progressive" } }
  "karaoke entry" / "instant on"
                           → apply_style_patch { animation: { preset: "karaoke", durationMs: 0 }, reel: { wordReveal: "progressive" } }
  "punchy" / "snap" (active emphasis, not entry — words still enter together)
                           → apply_style_patch { animation: { preset: "pop", scaleFrom: 0.6, durationMs: 80, emphasisScale: 1.35, spring: { damping: 14, stiffness: 240 } } }
  "drift" / "float"        → apply_style_patch { animation: { preset: "fade", durationMs: 350, emphasisScale: 1.05 }, reel: { wordReveal: "progressive" } }
  "softer" / "calmer"      → apply_style_patch { animation: { durationMs: 250, emphasisScale: 1.05 } }
  "longer entry" / "slower transition" → tune_field("animation.durationMs", 600)
  "snappier entry"         → tune_field("animation.durationMs", 100)
  "all at once" / "show everything together" / "no stagger" (revert progressive)
                           → tune_field("reel.wordReveal", "all")

  Typography / color —
  "bold" / "aggressive"    → tune_field("font.weight", 900) and tune_field("font.textTransform", "uppercase") in one turn
  "cyberpunk"              → apply_style_patch { color: { fill: "#00f0ff", emphasisFill: ["#ff00d0", "#00f0ff"], shadow: { color: "#00f0ff", blurPx: 28, offsetX: 0, offsetY: 0 } } }
  "retro" / "vintage"      → apply_style_patch { font: { family: "Instrument Serif", weight: 600 }, color: { fill: "#f6d68a", emphasisFill: "#c47a3c" } }

# StyleSpec schema (for apply_style_patch / tune_field — every field optional)

font: family / weight 100-900 / size px / letterSpacing px / textTransform none|uppercase|lowercase
color: fill hex / stroke hex / strokeWidth 0-24 / emphasisFill hex OR [hex,...] / background hex / shadow { color, blurPx, offsetX, offsetY } / fillGradient { type:"linear", angle, stops:[{pos,color}] }
layout: position top|middle|bottom / safeMargin 0-0.5 / maxWordsPerLine int / align left|center|right / padding {x,y} / borderRadius / gapRatio
animation: preset pop|fade|karaoke|typewriter|slide / durationMs 50-600 / emphasisScale 1-3 / scaleFrom 0-1 / activeBoost 1-2 / tailMs / spring { damping, stiffness, mass }
reel (reel-clone only): emphasisStyle inline-color|block|combined / emphasisFillRatio 0-1 / emphasisMaxHeightRatio 0-1 / cascadeTopRatio 0-1 / cascadeBottomRatio 0-1 / multiColorEmphasis bool / emphasisWeight 100-900 / wordReveal STRING "all"|"progressive" / emphasisTextTransform / fillerTextTransform / columnGapRatio 0-1 / rowGapRatio 0-1 / maxWidthPercent 0-100 (PERCENT, not fraction) / paddingPercent 0-100 (PERCENT) / italicAccentRate 0-1

UNIT RULES — reel.maxWidthPercent and reel.paddingPercent are PERCENTS (use 80 not 0.8). reel.wordReveal is a STRING (not true/false). reel.*Ratio fields are fractions (0-1).

# Selection scoping

Selection is a HINT, not a constraint. Read the user's language:
  - "make THIS red" (word selected)       → add_chunk_override on that chunk
  - "in INTRO" / "for the HERO card" /
    "only the OUTRO" / "in chunk 3"        → add_chunk_override on the chunk range that names that group/role
  - "make it red" (word selected)         → apply_style_patch globally; selection is incidental
  - "make all captions red"               → apply_style_patch globally even if a word is selected
  - "everything", "the whole video", "all" → always global

# Anti-patterns — do NOT do these

- Don't ship a one-line apply_style_patch when the user named a known archetype. Use apply_preset_pack (and compose multiple if the archetype needs it).
- Don't tune individual reel.* fields when apply_preset_pack or set_layout_strategy would do.
- Don't echo the full spec back in the assistant message. The patch IS the answer.
- Don't ask clarifying questions when the request is composable. Apply and move on.
- Don't use add_chunk_override for global language ("everything", "all captions", "make it"). Selection is a HINT.
- Don't invent presetIds. The complete list is above; if it's not there, use apply_style_patch or tune_field.
- Don't bump only font.size when the user wants uniformly large captions. The cascade + size multipliers will keep ~half the words small. Flatten cascadeTopRatio/cascadeBottomRatio to 1 and reset filler/emphasisSizeMultiplier to 1 in the SAME patch. See "Caption size" in Custom dials.

# Voice — assistantMessage

ONE short sentence after tool use. No prose, no bullets, no explanation of what the tool does.

- Applying ONE thing → tactile verb form: "Pumped." / "Slid in." / "Inverted." / "Held it." / "Tightened the entry."
- Applying MULTIPLE things → name them: "Hormozi cascade, plasma on emphasis." / "Submagic energy, thicker stroke." / "Cinematic theme with shockwave p0."
- Replying to a question with no change → acknowledge_no_change with a one-sentence answer.`;

// ---------------------------------------------------------------------------
// Module-level singletons: the checkpointer + LLM are reused across requests
// so the cache hits and the conversation persists by threadId.

let _checkpointer: unknown = null;
let _model: unknown = null;
let _modelId: string | null = null;
let _systemMessage: unknown = null;

async function getDeps(modelId: string) {
  // Lazy import — keeps API boot clean if the package is missing in some env.
  const { MemorySaver } = await import('@langchain/langgraph');
  const { ChatAnthropic } = await import('@langchain/anthropic');
  const { SystemMessage } = await import('@langchain/core/messages');

  if (!_checkpointer) _checkpointer = new MemorySaver();
  if (!_systemMessage) {
    _systemMessage = new SystemMessage({
      content: SYSTEM_PROMPT,
      additional_kwargs: { cache_control: { type: 'ephemeral' } },
    });
  }
  // Rebuild the model client only when the requested id changes. Cheap —
  // constructor only, no network. Anthropic's prompt cache is server-side
  // keyed on the prompt prefix so swapping clients doesn't invalidate it.
  if (!_model || _modelId !== modelId) {
    // Route Anthropic calls through OpenRouter. The @anthropic-ai/sdk (which
    // ChatAnthropic wraps) appends `/v1/messages` to anthropicApiUrl, so we
    // set the base to `https://openrouter.ai/api` and OpenRouter receives
    // POST /api/v1/messages — its Anthropic-compatible endpoint. OpenRouter
    // forwards cache_control through to Anthropic, so prompt caching still
    // works for Claude models.
    _model = new ChatAnthropic({
      model: modelId,
      apiKey: process.env.OPENROUTER_API_KEY,
      anthropicApiUrl: 'https://openrouter.ai/api',
      temperature: 0.4,
      maxRetries: 5,
      clientOptions: {
        defaultHeaders: {
          // OpenRouter's discovery/ranking headers — both optional but
          // helpful for visibility on the OpenRouter dashboard.
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Caption Studio Agent',
        },
      },
    });
    _modelId = modelId;
  }
  return { model: _model, checkpointer: _checkpointer, systemMessage: _systemMessage };
}

// ---------------------------------------------------------------------------
// Public entry point. Compiles a fresh ReAct agent per request (cheap) so
// each request's tools close over their own draftPatch + toolTrace without
// cross-request leakage. The checkpointer + system message are shared.

export async function runAgentChat(args: RunAgentChatArgs): Promise<RunAgentChatResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set — add it to .env to enable the agent');
  }

  const { tool } = await import('@langchain/core/tools');
  const { z } = await import('zod');
  const { HumanMessage } = await import('@langchain/core/messages');
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');

  const modelId = args.model ?? process.env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL;
  const { model, checkpointer, systemMessage } = await getDeps(modelId);

  // Per-request draft state. Tools mutate these closures.
  let draftPatch: AgentPatch | null = null;
  const toolTrace: AgentToolCall[] = [];

  const applyStylePatch = tool(
    (input: { styleSpec: Record<string, unknown> }) => {
      // Defensively normalize known model footguns BEFORE validating.
      // - reel.maxWidthPercent / paddingPercent: 0-100 range. If the model
      //   emits a fraction (≤ 1), multiply by 100. Without this, the
      //   renderer multiplies the (already-fraction) value by 1/100 and the
      //   text container collapses to ~zero width — captions vanish.
      // - reel.wordReveal: string enum, not boolean. Coerce true → 'progressive'.
      const styleSpec = JSON.parse(JSON.stringify(input.styleSpec)) as Record<string, unknown>;
      const reel = styleSpec.reel as Record<string, unknown> | undefined;
      if (reel) {
        if (typeof reel.maxWidthPercent === 'number' && reel.maxWidthPercent > 0 && reel.maxWidthPercent <= 1) {
          reel.maxWidthPercent = reel.maxWidthPercent * 100;
        }
        if (typeof reel.paddingPercent === 'number' && reel.paddingPercent > 0 && reel.paddingPercent < 1) {
          reel.paddingPercent = reel.paddingPercent * 100;
        }
        if (reel.wordReveal === true) reel.wordReveal = 'progressive';
        if (reel.wordReveal === false) reel.wordReveal = 'all';
      }

      // Validate the patch shape by merging onto current spec and running
      // it through StyleSpecSchema. Tolerant on unknown keys — the template
      // ignores anything it doesn't read.
      const merged = { ...args.currentSpec, ...styleSpec };
      const check = StyleSpecSchema.safeParse(merged);
      if (!check.success) {
        return JSON.stringify({
          ok: false,
          error: `patch failed validation: ${check.error.message.slice(0, 200)}`,
        });
      }
      draftPatch = { scope: 'global', styleSpec };
      toolTrace.push({ name: 'apply_style_patch', input: { styleSpec } });
      return JSON.stringify({ ok: true, applied: 'global' });
    },
    {
      name: 'apply_style_patch',
      description:
        'Apply a partial styleSpec patch globally. Only include the fields you are changing — omitted fields are preserved.',
      schema: z.object({
        styleSpec: z
          .record(z.string(), z.any())
          .describe('Partial StyleSpec — only the fields you are changing'),
      }),
    },
  );

  const addChunkOverride = tool(
    (input: { range: [number, number]; overrides: Record<string, unknown> }) => {
      draftPatch = {
        scope: 'chunk',
        chunkOverride: { range: input.range, overrides: input.overrides },
      };
      toolTrace.push({ name: 'add_chunk_override', input });
      return JSON.stringify({ ok: true, applied: 'chunk' });
    },
    {
      name: 'add_chunk_override',
      description:
        'Push a per-chunk override onto styleSpec.chunkOverrides. range is a [startChunk, endChunk] CHUNK index pair (not word indices).',
      schema: z.object({
        range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
        overrides: z
          .record(z.string(), z.any())
          .describe('Partial styleSpec fields scoped to this chunk range'),
      }),
    },
  );

  const switchTemplate = tool(
    (input: { templateId: 'reel-clone' | 'pop-words' | 'caption-designer' }) => {
      draftPatch = { ...(draftPatch ?? { scope: 'global' }), templateId: input.templateId };
      toolTrace.push({ name: 'switch_template', input });
      return JSON.stringify({ ok: true, applied: 'template' });
    },
    {
      name: 'switch_template',
      description:
        "Switch the template family. Use only when the user clearly wants a different look family ('cinematic' → reel-clone, 'minimal pop' → pop-words).",
      schema: z.object({
        templateId: z.enum(['reel-clone', 'pop-words', 'caption-designer']),
      }),
    },
  );

  const acknowledgeNoChange = tool(
    (input: { reason: string }) => {
      // Leaves draftPatch null. Tool exists so the model has a clean way
      // to respond to non-change queries without inventing a no-op patch.
      toolTrace.push({ name: 'acknowledge_no_change', input });
      return JSON.stringify({ ok: true, applied: 'none', reason: input.reason });
    },
    {
      name: 'acknowledge_no_change',
      description:
        "Acknowledge that no style change is needed (e.g. user asked a question, or the current look already matches). Pass a short reason.",
      schema: z.object({
        reason: z.string().describe('Short reason — what the user asked or why no change is warranted'),
      }),
    },
  );

  // Stage-scoped tools (Phase 8 — additive). Each validates input against
  // the typed Stylepack schemas in src/shared/pipeline/, then composes the
  // resulting partial into draftPatch.styleSpec so multiple stage-scoped
  // calls in one turn merge cleanly. The legacy apply_style_patch above
  // continues to work — these tools are the typed escape from its loose
  // Record<string, unknown> shape and from the defensive normalizers it
  // had to carry.
  const stageStylePatch = (draftStyleSpec: Record<string, unknown> | undefined): Record<string, unknown> => {
    return (draftStyleSpec ?? {}) as Record<string, unknown>;
  };
  const commitPatch = (name: string, input: unknown, result: ValidatorResult<unknown>): string => {
    if (!result.ok) {
      return JSON.stringify({ ok: false, error: result.error });
    }
    const base = stageStylePatch(draftPatch?.styleSpec) as StylepackPartial;
    const merged = composePartial(base, result.patch) as Record<string, unknown>;
    draftPatch = {
      scope: 'global',
      ...(draftPatch?.templateId ? { templateId: draftPatch.templateId } : {}),
      styleSpec: merged,
    };
    toolTrace.push({ name, input: input as Record<string, unknown> });
    return JSON.stringify({ ok: true, applied: result.applied });
  };

  const applyPresetTool = tool(
    (input: { slot: string; presetId: string }) => commitPatch('apply_preset_pack', input, validateApplyPreset(input)),
    {
      name: 'apply_preset_pack',
      description:
        'Compose a slotted preset pack onto the current draft. Slots: theme/font/palette/motion/accent/fx. The composer respects discriminator-aware merge so swapping one slot does not corrupt others.',
      schema: z.object({
        slot: z.enum(['theme', 'font', 'palette', 'motion', 'accent', 'fx']),
        presetId: z.string().describe('Preset id within the slot, e.g. "cinematicCascade", "interBlack", "plasmaEmphasis"'),
      }),
    },
  );

  const setEffectTool = tool(
    (input: { tier: string; effect: string; params?: Record<string, unknown> }) =>
      commitPatch('set_effect', input, validateSetEffect(input)),
    {
      name: 'set_effect',
      description:
        'Assign one motion FX effect to a tier. Validates effect id + params against the typed schema (rejects unknown effects and out-of-range intensities at the door instead of silently no-op-ing).',
      schema: z.object({
        tier: z.string().describe('"p0" (primary emphasis) | "p1" | "italic"'),
        effect: z.string().describe('Effect id from the registry (none/samba/crystal/magnetic/breathe/flare/resonance/plasma/inflation/ferro/shockwave/slice)'),
        params: z.record(z.string(), z.unknown()).optional().describe('Effect params, e.g. { intensity: 0.6 }'),
      }),
    },
  );

  const setLayoutStrategyTool = tool(
    (input: { strategy: string; params?: Record<string, unknown> }) =>
      commitPatch('set_layout_strategy', input, validateSetLayoutStrategy(input)),
    {
      name: 'set_layout_strategy',
      description:
        'Switch the layout strategy and its params. Old strategy params are discarded by the composer\'s discriminator-aware merge. Today only cascade-stack is wired in the renderer; the others are forward-compat hints.',
      schema: z.object({
        strategy: z.enum([
          'cascade-stack', 'single-line-flow', 'karaoke-row', 'centered-pop',
          'top-banner', 'lower-third', 'two-column-split', 'free-positioned',
        ]),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    },
  );

  const tuneFieldTool = tool(
    (input: { path: string; value: unknown }) => commitPatch('tune_field', input, validateTuneField(input)),
    {
      name: 'tune_field',
      description:
        'Escape-hatch dot-path dial for any single styleSpec field when no structured tool fits. Path examples: "color.emphasisFill", "reel.cascadeBottomRatio", "font.weight". Restricted to known top-level groups.',
      schema: z.object({
        path: z.string(),
        value: z.unknown(),
      }),
    },
  );

  // apply_director_script — delegates to the dedicated Director planner
  // (proposeDirectorScript) which has access to the full timed transcript
  // and a tuned system prompt for scaffold-sized plans. The chat agent
  // doesn't see the transcript on its turn (would blow the cache + tokens
  // for tweak-sized chats), so it can't hand-build a script with valid
  // word ranges. Instead, the agent signals intent — a paraphrased
  // description of what the user wants — and the tool body fetches the
  // planner result and writes it to draftPatch.
  //
  // Two-input compat: callers may still pass a full `script` object
  // (skips the planner call, validates + writes directly). That keeps
  // unit tests and admin tooling working without a transcript.
  const applyDirectorScriptTool = tool(
    async (input: { intent?: string; script?: unknown }) => {
      // Path A: full script supplied — validate and use as-is.
      if (input.script) {
        const parsed = directorScriptSchema.safeParse(input.script);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
          return JSON.stringify({ ok: false, error: `directorScript validation failed: ${issues}` });
        }
        draftPatch = {
          scope: 'global',
          ...(draftPatch?.styleSpec ? { styleSpec: draftPatch.styleSpec } : {}),
          ...(draftPatch?.templateId ? { templateId: draftPatch.templateId } : {}),
          directorScript: parsed.data,
        };
        toolTrace.push({
          name: 'apply_director_script',
          input: { groups: parsed.data.groups.length, beats: parsed.data.beats.length, source: 'inline' },
        });
        return JSON.stringify({
          ok: true,
          applied: 'directorScript',
          groups: parsed.data.groups.length,
          beats: parsed.data.beats.length,
          source: 'inline',
        });
      }

      // Path B: agent only signals intent; tool calls the dedicated planner.
      if (!args.transcript || args.transcript.length === 0) {
        return JSON.stringify({
          ok: false,
          error:
            'No transcript available on this turn. The Director planner needs the timed transcript to build word ranges. The web client should be passing it via the /agent/chat request body.',
        });
      }
      const intent = (input.intent ?? args.message).trim();
      const result = await proposeDirectorScript({
        transcript: args.transcript,
        message: intent,
      });
      if (!result.ok) {
        return JSON.stringify({
          ok: false,
          error: `director planner failed: ${result.error}`,
          attempts: result.attempts,
        });
      }
      draftPatch = {
        scope: 'global',
        ...(draftPatch?.styleSpec ? { styleSpec: draftPatch.styleSpec } : {}),
        ...(draftPatch?.templateId ? { templateId: draftPatch.templateId } : {}),
        directorScript: result.script,
      };
      toolTrace.push({
        name: 'apply_director_script',
        input: { intent, groups: result.script.groups.length, beats: result.script.beats.length, source: 'planner', attempts: result.attempts },
      });
      return JSON.stringify({
        ok: true,
        applied: 'directorScript',
        groups: result.script.groups.length,
        beats: result.script.beats.length,
        source: 'planner',
        attempts: result.attempts,
      });
    },
    {
      name: 'apply_director_script',
      description:
        "Build a whole-video DirectorScript. Used for scaffold-sized requests ('build a reel', 'make this cinematic', 'plan the sections'). PASS ONLY THE `intent` PARAMETER — a one-sentence paraphrase of what the user wants the plan to express. The tool delegates to the dedicated Director planner which has the full timed transcript; you do NOT need to construct word ranges yourself. The planner segments the transcript by FUNCTIONAL ROLE (intro-hook, hero-title-card, backstory-beat, enumerated-list, stat-callout, pull-quote, pov-shift, comparison-pair, cta-overlay, outro).",
      schema: z.object({
        intent: z
          .string()
          .min(8)
          .describe(
            "REQUIRED. A one-sentence paraphrase of the user's scaffold intent — what shape of reel they want, what beats and audio cues to land. The planner uses this to make role/layout choices. Example: 'Cinematic 7-shot reel with stacked title, chapter callouts, brand drop on Heal Man, audio cues on each chapter'.",
          ),
        script: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'ADVANCED escape hatch: pass a fully-formed DirectorScript JSON to skip the planner. Almost always you should pass `intent` instead.',
          ),
      }),
    },
  );

  const agent = createReactAgent({
    // ChatAnthropic implements the LanguageModelLike interface used by
    // createReactAgent — the cast is for the cache between getDeps()
    // (typed as `unknown` to avoid importing the type at module top).
    llm: model as Parameters<typeof createReactAgent>[0]['llm'],
    tools: [
      applyStylePatch, addChunkOverride, switchTemplate, acknowledgeNoChange,
      applyPresetTool, setEffectTool, setLayoutStrategyTool, tuneFieldTool,
      applyDirectorScriptTool,
    ],
    prompt: systemMessage as Parameters<typeof createReactAgent>[0]['prompt'],
    checkpointer: checkpointer as Parameters<typeof createReactAgent>[0]['checkpointer'],
  });

  // Build the user turn. Authoritative current spec goes into the turn body
  // so the model never has to trust stale spec from earlier in the thread.
  const wordHint = args.selectedWord
    ? `\nSelected word (HINT, not a constraint): "${args.selectedWord.text}" at ${args.selectedWord.t.toFixed(2)}s (idx ${args.selectedWord.idx}).`
    : '';
  const transcriptHint = args.transcriptSummary
    ? `\nClip: ${args.transcriptSummary.totalWords} words, ${args.transcriptSummary.durationSec.toFixed(2)}s.`
    : '';

  // Compact state digest instead of dumping the raw spec (1-3K tokens of
  // mostly-default JSON). The state line names the active archetype + slots
  // so the agent recognizes vocabulary it just emitted; the overrides map
  // shows only fields that differ from the template's canonical default.
  const stateLine = summarizeSpec(args.currentSpec ?? {});
  const overrides = diffFromDefaults(args.currentSpec ?? {}, args.templateId);
  const userContent = `AUTHORITATIVE current templateId: ${args.templateId}
${stateLine}
Overrides (diff vs ${args.templateId}-default): ${JSON.stringify(overrides)}${wordHint}${transcriptHint}

User: ${args.message}`;

  const start = Date.now();
  const result = await agent.invoke(
    { messages: [new HumanMessage(userContent)] },
    {
      configurable: { thread_id: args.threadId },
      recursionLimit: 8,
    },
  );

  // The final AI message is the model's text reply after the last tool turn.
  const finalMessages = (result as { messages: Array<{ content?: unknown; getType?: () => string }> })
    .messages;
  let assistantMessage = '';
  for (let i = finalMessages.length - 1; i >= 0; i--) {
    const m = finalMessages[i];
    if (!m) continue;
    const t = typeof m.getType === 'function' ? m.getType() : '';
    if (t === 'ai') {
      const c = m.content;
      if (typeof c === 'string' && c.trim().length > 0) {
        assistantMessage = c.trim();
        break;
      }
      if (Array.isArray(c)) {
        // Anthropic returns content blocks; the trailing text block is the
        // human-readable reply.
        for (const block of c) {
          if (typeof block === 'object' && block && (block as { type?: string }).type === 'text') {
            const text = (block as { text?: string }).text;
            if (typeof text === 'string' && text.trim().length > 0) {
              assistantMessage = text.trim();
            }
          }
        }
        if (assistantMessage) break;
      }
    }
  }
  if (!assistantMessage) {
    assistantMessage = draftPatch ? 'Applied.' : 'Held it.';
  }

  const ms = Date.now() - start;
  // Mirror the cache-hit logging shape from generateStyle.ts so cost
  // regressions are visible in the same `(cache hit: N tokens)` format.
  const usage = (
    finalMessages[finalMessages.length - 1] as { usage_metadata?: { input_token_details?: { cache_read?: number } } }
  )?.usage_metadata;
  const cacheRead = usage?.input_token_details?.cache_read;
  console.log(
    `agentChat[${args.threadId.slice(0, 8)}] model=${modelId}: ${ms}ms ${cacheRead ? `(cache hit: ${cacheRead} tokens)` : '(cache miss)'} tools=${toolTrace.length}`,
  );

  return {
    assistantMessage,
    patch: draftPatch,
    toolTrace,
  };
}

// ---------------------------------------------------------------------------
// In-memory per-user rate limit. Matches the user's standing preference to
// not let API loops burn credits unattended. Sliding 1-hour window.

const _rateLimit = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 30;

export function checkAgentRateLimit(userId: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const arr = (_rateLimit.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    const oldest = arr[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    return { ok: false, retryAfterSec };
  }
  arr.push(now);
  _rateLimit.set(userId, arr);
  return { ok: true };
}

// Exported so a test or admin path could clear it; unused in normal flow.
export function _resetAgentRateLimit(): void {
  _rateLimit.clear();
}

// ---------------------------------------------------------------------------
// Re-export StyleSpec just so callers don't need to dig into shared/.

export type { StyleSpec };
