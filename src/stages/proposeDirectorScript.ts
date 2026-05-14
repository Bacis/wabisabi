// Director planner — single-shot JSON emitter that produces a Zod-validated
// DirectorScript from a transcript + user prompt. Day 7 of the Director feature.
//
// Architecture: a one-shot LLM call (no tools), more like generateStyle.ts
// than agentChat.ts. The planner reads the whole transcript, decides scene
// groups, and emits a JSON object. Retry-once-with-error recovers from the
// most common model mistakes (overlapping ranges, orphan beats, invalid
// enums) — the second attempt sees the Zod error message as part of its
// user message.
//
// Routing: defaults to Claude Sonnet 4.5 because planning is more complex
// than the Haiku-handled tweak path. Caller can override per-request via
// `model`. The SYSTEM_PROMPT is cached ephemerally so the second turn (and
// any future calls) hits the prefix cache.

import { directorScriptSchema, type DirectorScript } from '../shared/director/schema.js';
import { DIRECTOR_SYSTEM_PROMPT } from './agentPrompts/director.system.js';

const DEFAULT_PLANNER_MODEL = 'anthropic/claude-sonnet-4.5';

// ---------------------------------------------------------------------------
// Wire types.

export type PlannerWord = {
  idx: number;
  t: number;          // start time in seconds
  w: string;
};

export type ProposeDirectorScriptArgs = {
  /** Compact transcript — array of {idx, t, w}. The planner reads these as a sequence. */
  transcript: PlannerWord[];
  /** Free-text user prompt ("build me a cinematic reel", etc.). */
  message: string;
  /** If editing an existing plan, pass the prior script so the model can iterate. */
  currentScript?: DirectorScript;
  /** Optional model override. Defaults to PLANNER_MODEL env, then Sonnet 4.5. */
  model?: string;
};

export type ProposeDirectorScriptResult =
  | { ok: true; script: DirectorScript; attempts: number; notes?: string }
  | { ok: false; error: string; lastRaw?: string; attempts: number };

// ---------------------------------------------------------------------------
// Module-level singletons for the model + system message — keeps the
// Anthropic ephemeral prompt cache warm between calls.

let _model: unknown = null;
let _modelId: string | null = null;
let _systemMessage: unknown = null;

async function getDeps(modelId: string) {
  const { ChatAnthropic } = await import('@langchain/anthropic');
  const { SystemMessage } = await import('@langchain/core/messages');
  if (!_systemMessage) {
    _systemMessage = new SystemMessage({
      content: DIRECTOR_SYSTEM_PROMPT,
      additional_kwargs: { cache_control: { type: 'ephemeral' } },
    });
  }
  if (!_model || _modelId !== modelId) {
    _model = new ChatAnthropic({
      model: modelId,
      apiKey: process.env.OPENROUTER_API_KEY,
      anthropicApiUrl: 'https://openrouter.ai/api',
      // Lower temperature than chat — planning should be more deterministic.
      temperature: 0.2,
      maxRetries: 5,
      clientOptions: {
        defaultHeaders: {
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Caption Studio Director Planner',
        },
      },
    });
    _modelId = modelId;
  }
  return { model: _model, systemMessage: _systemMessage };
}

// ---------------------------------------------------------------------------
// JSON extraction. The model occasionally wraps its output in a ```json fence
// or adds a short preamble despite the prompt's instructions. We extract the
// first top-level {...} blob defensively.

function extractJson(raw: string): string | null {
  // Strip a leading ```json or ``` fence if present.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  // Otherwise locate the first balanced top-level object.
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public entry point.

export async function proposeDirectorScript(
  args: ProposeDirectorScriptArgs,
): Promise<ProposeDirectorScriptResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      ok: false,
      error: 'OPENROUTER_API_KEY is not set — add it to .env to enable the Director planner',
      attempts: 0,
    };
  }
  const { HumanMessage } = await import('@langchain/core/messages');
  const modelId =
    args.model ?? process.env.PLANNER_MODEL ?? DEFAULT_PLANNER_MODEL;
  const { model, systemMessage } = await getDeps(modelId);

  // Compose the user message. The transcript is the planner's primary signal;
  // currentScript is included when iterating ("change the CTA color").
  const userParts: string[] = [];
  userParts.push(`User: ${args.message}`);
  userParts.push(`Transcript (compact, ${args.transcript.length} words): ${JSON.stringify(args.transcript)}`);
  if (args.currentScript) {
    userParts.push(`Current script (edit, do not start from scratch): ${JSON.stringify(args.currentScript)}`);
  }
  userParts.push('Respond with ONE JSON object matching DirectorScript. No prose, no markdown.');
  const baseUserText = userParts.join('\n\n');

  let lastRaw = '';
  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const userText =
      attempt === 1
        ? baseUserText
        : `${baseUserText}\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${lastError}\n\nFix the issues and re-emit the full JSON.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (model as any).invoke([
      systemMessage,
      new HumanMessage({ content: userText }),
    ]);
    const raw =
      typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c: { text?: string }) => c.text ?? '')
              .join('')
          : '';
    lastRaw = raw;

    const json = extractJson(raw);
    if (!json) {
      lastError = `no JSON object found in model output (raw length ${raw.length})`;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      lastError = `JSON.parse failed: ${(e as Error).message.slice(0, 200)}`;
      continue;
    }
    const check = directorScriptSchema.safeParse(parsed);
    if (check.success) {
      return { ok: true, script: check.data, attempts: attempt };
    }
    lastError = check.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
  }

  return { ok: false, error: lastError, lastRaw, attempts: 2 };
}
