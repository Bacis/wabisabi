// Direct unit-style probe of enrichTranscript. Loads .env via the prelude,
// constructs a synthetic Transcript, calls enrichTranscript() once, and
// prints the resulting CaptionPlan. Exits non-zero if the LLM call fails
// or the plan is null so this can be wired into CI if we ever add one.
//
// Run with: node_modules/.bin/tsx scripts/test-enrich.ts
import '../src/env.js';
import { enrichTranscript } from '../src/stages/enrichTranscript.js';
import type { Transcript } from '../src/shared/types.js';

// A deliberately punchy script with obvious emphasis candidates — proper
// nouns, action verbs, numbers, emotional words. Haiku should nail these.
const TEXT =
  "I spent twelve years building this product and nobody wanted it. " +
  "Then one tiny feature changed everything overnight. " +
  "My name is Bacis and I shipped it last Tuesday. " +
  "Try it now at captions dot dev.";

// Build a synthetic transcript with plausible per-word timings. Not real
// alignments — just enough to look like Whisper output so enrichTranscript
// can validate it.
function buildTranscript(text: string): Transcript {
  const words = text.split(/\s+/);
  let t = 0;
  return {
    language: 'en',
    duration: words.length * 0.35,
    words: words.map((word) => {
      const start = t;
      const dur = 0.15 + word.length * 0.03;
      t += dur + 0.05;
      return { word, start, end: start + dur, confidence: 0.95 };
    }),
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set in env — enrichTranscript will return null.');
    process.exit(2);
  }

  const transcript = buildTranscript(TEXT);
  console.log(`input:   ${transcript.words.length} words, ${transcript.duration.toFixed(1)}s duration`);
  console.log(`text:    "${TEXT}"`);
  console.log();

  const start = Date.now();
  const plan = await enrichTranscript(transcript);
  const ms = Date.now() - start;

  if (!plan) {
    console.error(`enrichTranscript returned null (check worker log for validation error)`);
    process.exit(3);
  }

  console.log(`result:  ${plan.chunks.length} chunks (${ms}ms)`);
  console.log();
  for (let i = 0; i < plan.chunks.length; i++) {
    const c = plan.chunks[i]!;
    const parts = c.words.map((w, wi) => (c.emphasis[wi] ? `*${w.word}*` : w.word));
    const start = c.words[0]!.start.toFixed(2);
    const end = c.words[c.words.length - 1]!.end.toFixed(2);
    console.log(`  ${i.toString().padStart(2)}.  [${start}s-${end}s]  ${parts.join(' ')}`);
  }

  // Sanity checks — should never be empty, should cover every input word,
  // should have at least one emphasized word somewhere.
  const totalCovered = plan.chunks.reduce((n, c) => n + c.words.length, 0);
  const totalEmphasis = plan.chunks.reduce(
    (n, c) => n + c.emphasis.filter(Boolean).length,
    0,
  );
  console.log();
  console.log(`coverage:  ${totalCovered}/${transcript.words.length} words`);
  console.log(`emphasis:  ${totalEmphasis} words marked across ${plan.chunks.length} chunks`);

  if (totalCovered !== transcript.words.length) {
    console.error('FAIL: not every word is covered by a chunk');
    process.exit(4);
  }
  if (totalEmphasis === 0) {
    console.error('WARN: no emphasis flags set — LLM may have under-delivered');
  }

  console.log();
  console.log('PASS');
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
