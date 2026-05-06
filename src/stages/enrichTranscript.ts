import { z } from 'zod';
import type { CaptionChunk, CaptionPlan, Transcript, Word } from '../shared/types.js';

const MAX_WORDS_PER_CHUNK = 5;

// One LLM pass that does both jobs at once: semantic chunking AND per-word
// emphasis. Cheaper and more coherent than two passes — emphasis decisions
// can take chunk context into account.
//
// If ANTHROPIC_API_KEY isn't set or the call fails (or the response fails
// validation), this stage returns null and the render template falls back
// to its built-in fixed-N chunker with no emphasis. The pipeline never
// hard-fails on enrichment.
const SYSTEM_PROMPT = `You are a caption editor for short-form vertical video (TikTok/Reels/Shorts).

Your job: group spoken words into caption lines and mark 1-2 words per line to emphasize visually.

HARD CONSTRAINTS (these will be enforced — chunks longer than 5 words are mechanically split):
- 2 to 5 words per chunk. Aim for 3-4.
- Break at natural clause boundaries, sentence ends, or topic shifts
- Cover EVERY word from index 0 to the last index. Chunks must be contiguous and non-overlapping.
- A long sentence MUST be broken into multiple chunks of 3-5 words each.

Chunking guidance:
- Avoid splitting tightly bound phrases ("New York", "fed up")
- Prefer breaks at conjunctions, prepositions, and after punctuation

Emphasis rules:
- Emphasize: proper nouns, action verbs, numbers, surprising/emotional words, key concepts
- Skip: articles, prepositions, common pronouns, fillers ("the", "a", "of", "I'm", "is", "and", "to")
- A line may have zero emphasis if no word clearly stands out

Output JSON only — no prose, no markdown fences, no explanation.`;

const rawChunkSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  emphasis: z.array(z.number().int().nonnegative()),
});

const rawPlanSchema = z.object({
  chunks: z.array(rawChunkSchema),
});

type RawPlan = z.infer<typeof rawPlanSchema>;

function buildUserMessage(words: Word[]): string {
  const wordList = words.map((w, i) => `${i}: ${w.word}`).join('\n');
  const lastIdx = words.length - 1;
  return `Group these words into caption lines and mark emphasis. Output JSON only.

Format:
{"chunks":[{"start":0,"end":3,"emphasis":[2]},{"start":4,"end":7,"emphasis":[5,7]}]}

start and end are inclusive 0-based indices into the words list below.

There are exactly ${words.length} words, indexed 0 through ${lastIdx} inclusive.
The first chunk MUST start at 0. The last chunk MUST end at exactly ${lastIdx}. Do not invent indices beyond ${lastIdx}.

Words:
${wordList}`;
}

// Validate that the LLM's chunk list is contiguous, non-overlapping, and
// covers every word index. Returns null on success, error string on failure.
function validateCoverage(raw: RawPlan, totalWords: number): string | null {
  if (raw.chunks.length === 0) return 'no chunks returned';
  let cursor = 0;
  for (const [i, c] of raw.chunks.entries()) {
    if (c.start !== cursor) {
      return `chunk ${i} starts at ${c.start}, expected ${cursor} (gap or overlap)`;
    }
    if (c.end < c.start) {
      return `chunk ${i} has end ${c.end} < start ${c.start}`;
    }
    if (c.end >= totalWords) {
      return `chunk ${i} end ${c.end} out of range (${totalWords} words)`;
    }
    for (const e of c.emphasis) {
      if (e < c.start || e > c.end) {
        return `chunk ${i} emphasis ${e} outside [${c.start}, ${c.end}]`;
      }
    }
    cursor = c.end + 1;
  }
  if (cursor !== totalWords) {
    return `chunks covered ${cursor}/${totalWords} words`;
  }
  return null;
}

function resolveCaptionPlan(raw: RawPlan, words: Word[]): CaptionPlan {
  return {
    chunks: raw.chunks.map((c) => {
      const chunkWords = words.slice(c.start, c.end + 1);
      const emphasisSet = new Set(c.emphasis);
      const emphasis = chunkWords.map((_, i) => emphasisSet.has(c.start + i));
      return { words: chunkWords, emphasis };
    }),
  };
}

// Mechanically enforce the chunk-size ceiling. The LLM occasionally produces
// a long chunk despite the prompt; we split it at the largest temporal gap
// (the natural pause), recursively until every chunk is within the cap.
function splitLongChunks(plan: CaptionPlan, maxWords: number): CaptionPlan {
  const out: CaptionChunk[] = [];

  function pushSplit(chunk: CaptionChunk): void {
    if (chunk.words.length <= maxWords) {
      out.push(chunk);
      return;
    }
    // Find the index with the largest gap from the previous word's end to
    // this word's start. That's the natural pause. Fall back to the midpoint
    // if all gaps are zero (unlikely in real speech).
    let splitIdx = Math.floor(chunk.words.length / 2);
    let maxGap = -Infinity;
    for (let i = 1; i < chunk.words.length; i++) {
      const gap = chunk.words[i]!.start - chunk.words[i - 1]!.end;
      if (gap > maxGap) {
        maxGap = gap;
        splitIdx = i;
      }
    }
    const left: CaptionChunk = {
      words: chunk.words.slice(0, splitIdx),
      emphasis: chunk.emphasis.slice(0, splitIdx),
    };
    const right: CaptionChunk = {
      words: chunk.words.slice(splitIdx),
      emphasis: chunk.emphasis.slice(splitIdx),
    };
    pushSplit(left);
    pushSplit(right);
  }

  for (const chunk of plan.chunks) {
    pushSplit(chunk);
  }
  return { chunks: out };
}

// Strip markdown code fences if the model wraps its JSON in them despite the
// instructions. Belt and suspenders — Haiku usually obeys but we don't want
// the whole pipeline to fall back over a stray ```.
function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

// Extract the first complete top-level JSON object from a string. Haiku sometimes
// appends trailing commentary after the JSON despite "JSON only" instructions;
// rather than fail the whole stage, scan brace depth and return only the object.
function extractFirstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text;
}

export async function enrichTranscript(
  transcript: Transcript,
): Promise<CaptionPlan | null> {
  if (transcript.words.length === 0) return null;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      'enrich: ANTHROPIC_API_KEY not set, skipping LLM enrichment (template will use fixed-N fallback)',
    );
    return null;
  }

  // Lazy import so the worker can boot even if the SDK isn't installed.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // 5 retries (SDK default is 2) to ride out 529 Overloaded spikes.
  const client = new Anthropic({ maxRetries: 5 });

  const userMessage = buildUserMessage(transcript.words);
  const start = Date.now();
  const MAX_ATTEMPTS = 3;

  let validRaw: RawPlan | null = null;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let text: string;
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });
      const block = response.content[0];
      text = block && block.type === 'text' ? block.text : '';
    } catch (err) {
      console.error(`enrich: attempt ${attempt} LLM call failed`, err);
      lastError = (err as Error).message ?? 'LLM call failed';
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractFirstJsonObject(stripFences(text)));
    } catch (err) {
      lastError = `parse: ${(err as Error).message}`;
      console.error(
        `enrich: attempt ${attempt} JSON parse failed`,
        lastError,
        `\nfirst 200 chars: ${text.slice(0, 200)}`,
      );
      continue;
    }

    const result = rawPlanSchema.safeParse(parsed);
    if (!result.success) {
      lastError = `schema: ${JSON.stringify(result.error.flatten())}`;
      console.error(`enrich: attempt ${attempt} schema validation failed`, lastError);
      continue;
    }

    const coverageError = validateCoverage(result.data, transcript.words.length);
    if (coverageError) {
      lastError = `coverage: ${coverageError}`;
      console.error(`enrich: attempt ${attempt} ${lastError}`);
      continue;
    }

    validRaw = result.data;
    break;
  }

  if (!validRaw) {
    console.error(`enrich: all ${MAX_ATTEMPTS} attempts failed (last: ${lastError}), falling back`);
    return null;
  }

  const rawPlan = resolveCaptionPlan(validRaw, transcript.words);
  const plan = splitLongChunks(rawPlan, MAX_WORDS_PER_CHUNK);
  const ms = Date.now() - start;
  const splits = plan.chunks.length - rawPlan.chunks.length;
  const splitNote = splits > 0 ? ` (split ${splits} oversize chunks)` : '';
  console.log(
    `enrich: ${plan.chunks.length} chunks from ${transcript.words.length} words (${ms}ms)${splitNote}`,
  );
  return plan;
}
