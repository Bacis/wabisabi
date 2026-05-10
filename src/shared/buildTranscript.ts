import type { Transcript, Word } from './types.js';

// Build a Transcript from raw text by spreading words uniformly across the
// clip's duration. Used in two places:
//
//   1. Stock-clip seeding when the source video has no audio (or audio that
//      Whisper hallucinates over) — we ship hand-written placeholder
//      narration that the user is meant to edit.
//   2. The web editor's transcript override — when a user types their own
//      script over a stock clip, we re-derive timing from the new text on
//      the fly so the live <Player> updates without a server roundtrip.
//
// Each word gets `wordRatio` of its time slot; the remaining sliver acts
// as a natural inter-word gap so the caption animation has somewhere to
// breathe between words. The captionPlan is intentionally NOT generated
// here — emit `null` so the render templates fall back to their built-in
// fixed-N chunker. LLM-driven chunking only makes sense when the source
// transcript is real.
export function buildTranscriptFromText(text: string, durationSec: number): Transcript {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || durationSec <= 0) {
    return { language: 'en', duration: durationSec, words: [] };
  }
  const slotLen = durationSec / words.length;
  const wordRatio = 0.88;
  const out: Word[] = words.map((w, i) => {
    const start = round3(i * slotLen);
    const end = round3(start + slotLen * wordRatio);
    return { word: w, start, end, confidence: 1 };
  });
  return { language: 'en', duration: durationSec, words: out };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
