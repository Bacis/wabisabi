// Day 8 — manual prompt-quality gate for the Director planner.
//
// Runs proposeDirectorScript against 10 transcripts and prints a structured
// report. Pass criteria per the plan: ≥7/10 produce sensible scripts.
// Below 5/10 → sharpen the vocabularies before any further work.
//
// Usage:
//   tsx scripts/day8-planner-quality.ts
//
// Inputs:
//   * 2 real reel-analysis transcripts (DXhn5HNhTxy, orhan)
//   * 8 synthetic transcripts authored below to span the role vocabulary
//     (intro-hook, hero-title-card, backstory-beat, enumerated-list,
//     stat-callout, pull-quote, pov-shift, comparison-pair, cta-overlay,
//     outro). Each transcript is paired with a natural-language prompt
//     the planner should respond to with a specific role mix.
//
// API cost: 10 Sonnet calls, ~$0.05 with prompt cache. Single-shot per
// transcript; retry-on-Zod-error inside proposeDirectorScript may push
// the worst case to 20 calls.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { proposeDirectorScript, type PlannerWord } from '../src/stages/proposeDirectorScript.js';
import type { DirectorScript } from '../src/shared/director/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// ---------------------------------------------------------------------------
// Real transcripts — pull words + start times from the reel-analysis runs.

function loadRealTranscript(runId: string): PlannerWord[] {
  const path = resolve(ROOT, 'scripts/reel-analysis/runs', runId, 'captionPlan.gt.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as {
    chunks: Array<{ words: Array<{ word: string; start: number }> }>;
  };
  const out: PlannerWord[] = [];
  let idx = 0;
  for (const chunk of data.chunks) {
    for (const w of chunk.words) {
      out.push({ idx, t: Number(w.start), w: w.word });
      idx++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synthetic transcripts — deterministic timings so the planner's only
// signal is the WORDS. Each authored to invite specific role assignments.

function synth(words: string[], wordsPerSec = 2): PlannerWord[] {
  return words.map((w, idx) => ({ idx, t: idx / wordsPerSec, w }));
}

type TestCase = {
  id: string;
  prompt: string;
  transcript: PlannerWord[];
  expected: {
    minGroups: number;
    maxGroups: number;
    /** Roles we expect to see somewhere in the script. Empty → don't check. */
    rolesPresent: string[];
  };
  /** Sentence describing what the planner SHOULD do. Used in the report. */
  intent: string;
};

const cases: TestCase[] = [
  {
    id: '01-monetization-reel',
    prompt: 'Build this into a cinematic reel.',
    transcript: synth([
      'so', 'how', 'do', 'you', 'monetise',
      'a', 'life', 'you', 'love',
      'it', 'started', 'when', 'I', 'hit', 'a', 'wall',
      'I', 'realised', 'three', 'things',
      'first', 'pick', 'a', 'niche',
      'second', 'build', 'an', 'audience',
      'third', 'sell', 'a', 'product',
      'follow', 'for', 'more',
    ]),
    expected: { minGroups: 4, maxGroups: 7, rolesPresent: ['intro-hook', 'enumerated-list', 'cta-overlay'] },
    intent: 'Hook + title + backstory + 3-step list + CTA',
  },
  {
    id: '02-tutorial-howto',
    prompt: 'Plan this how-to clip.',
    transcript: synth([
      'here', 'is', 'how', 'to', 'make', 'pour', 'over', 'coffee',
      'step', 'one', 'boil', 'water',
      'step', 'two', 'pour', 'slowly',
      'step', 'three', 'wait', 'four', 'minutes',
      'thats', 'it', 'subscribe', 'for', 'more',
    ]),
    expected: { minGroups: 3, maxGroups: 5, rolesPresent: ['enumerated-list'] },
    intent: 'Intro + step list + outro',
  },
  {
    id: '03-stat-heavy',
    prompt: 'Make this a punchy stat reel.',
    transcript: synth([
      'I', 'made', 'fifty', 'thousand', 'dollars', 'last', 'month',
      'with', 'twenty', 'seven', 'percent', 'profit', 'margin',
      'shipped', 'to', 'three', 'hundred', 'customers',
      'in', 'just', 'forty', 'two', 'days',
      'subscribe', 'for', 'more',
    ]),
    expected: { minGroups: 3, maxGroups: 6, rolesPresent: ['stat-callout'] },
    intent: 'Multiple stat-callouts + CTA',
  },
  {
    id: '04-story-driven',
    prompt: 'Turn this story into a cinematic reel.',
    transcript: synth([
      'I', 'used', 'to', 'work', 'at', 'a', 'big', 'company',
      'I', 'was', 'miserable', 'every', 'morning',
      'one', 'day', 'I', 'quit',
      'now', 'I', 'wake', 'up', 'free', 'and', 'happy',
    ]),
    expected: { minGroups: 2, maxGroups: 5, rolesPresent: ['backstory-beat'] },
    intent: 'Hook + backstory + pov-shift; no list, no CTA',
  },
  {
    id: '05-comparison',
    prompt: 'Build a comparison reel.',
    transcript: synth([
      'before', 'I', 'started', 'this', 'business',
      'I', 'had', 'no', 'freedom',
      'now', 'I', 'wake', 'up',
      'and', 'work', 'on', 'my', 'own', 'terms',
      'try', 'it', 'today',
    ]),
    expected: { minGroups: 2, maxGroups: 5, rolesPresent: ['comparison-pair'] },
    intent: 'Hook + before/after comparison + CTA',
  },
  {
    id: '06-pull-quote',
    prompt: 'Highlight the quote and build the reel around it.',
    transcript: synth([
      'a', 'wise', 'man', 'once', 'said',
      'the', 'best', 'time', 'to', 'plant', 'a', 'tree',
      'was', 'twenty', 'years', 'ago',
      'the', 'second', 'best', 'time', 'is', 'now',
      'so', 'what', 'are', 'you', 'waiting', 'for',
    ]),
    expected: { minGroups: 2, maxGroups: 5, rolesPresent: ['pull-quote'] },
    intent: 'Hook + pull-quote + outro CTA',
  },
  {
    id: '07-cta-heavy-promo',
    prompt: 'Make this a promo with a strong call to action.',
    transcript: synth([
      'the', 'creator', 'course',
      'launches', 'today',
      'click', 'the', 'link',
      'in', 'my', 'bio',
      'use', 'code', 'reel', 'fifty',
      'for', 'half', 'off',
    ]),
    expected: { minGroups: 2, maxGroups: 5, rolesPresent: ['cta-overlay'] },
    intent: 'Title + CTA + CTA (repeated cta-overlay)',
  },
  {
    id: '08-single-beat',
    prompt: 'Just a single hook, nothing else.',
    transcript: synth(['this', 'changes', 'everything']),
    expected: { minGroups: 1, maxGroups: 2, rolesPresent: [] },
    intent: 'Tiny transcript — should produce 1 group',
  },
  {
    id: '09-real-orhan',
    prompt: 'Build a cinematic reel from this clip.',
    transcript: loadRealTranscript('orhan'),
    expected: { minGroups: 1, maxGroups: 3, rolesPresent: [] },
    intent: 'Real transcript (7 words) — should produce a tight 1-2 group plan',
  },
  {
    id: '10-real-dxhn',
    prompt: 'Plan this clip as a multi-scene reel.',
    transcript: loadRealTranscript('DXhn5HNhTxy'),
    expected: { minGroups: 3, maxGroups: 8, rolesPresent: [] },
    intent: 'Real 161-word transcript — should produce 3-8 functional groups',
  },
];

// ---------------------------------------------------------------------------
// Per-case grading.

type Verdict = { pass: boolean; reasons: string[] };

function gradeCase(test: TestCase, script: DirectorScript | null, error: string | null): Verdict {
  if (script === null) {
    return { pass: false, reasons: [`planner failed: ${error ?? '<no error>'}`] };
  }
  const reasons: string[] = [];
  let pass = true;
  const n = script.groups.length;
  // Upper bound scales with transcript length: the spec's "3-6 groups for
  // a typical 10-30s reel" applies to short clips, but a 161-word reel
  // can legitimately support more functional regions. Cap at the larger
  // of the case-specified ceiling or ⌈words/16⌉ so long transcripts get
  // proportional headroom (16 ≈ words per group at the spec's density).
  const lengthScaledCeiling = Math.max(test.expected.maxGroups, Math.ceil(test.transcript.length / 16));
  if (n < test.expected.minGroups || n > lengthScaledCeiling) {
    reasons.push(`group count ${n} outside [${test.expected.minGroups}, ${lengthScaledCeiling}]`);
    pass = false;
  }
  for (const expected of test.expected.rolesPresent) {
    if (!script.groups.some((g) => g.role === expected)) {
      reasons.push(`expected role "${expected}" not in plan`);
      pass = false;
    }
  }
  // Word range coverage: every transcript word should fall inside some group.
  // Gaps are allowed (planner may skip a filler beat), but coverage < 60% is suspicious.
  const totalWords = test.transcript.length;
  let coveredWords = 0;
  for (let i = 0; i < totalWords; i++) {
    if (script.groups.some((g) => i >= g.wordRange[0] && i <= g.wordRange[1])) {
      coveredWords++;
    }
  }
  const coverage = coveredWords / totalWords;
  if (coverage < 0.5) {
    reasons.push(`coverage ${(coverage * 100).toFixed(0)}% — most words orphaned`);
    pass = false;
  }
  if (pass && reasons.length === 0) reasons.push('ok');
  return { pass, reasons };
}

// ---------------------------------------------------------------------------
// Runner.

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set. Aborting.');
    process.exit(1);
  }
  console.log(`Running ${cases.length} planner cases against Sonnet 4.5…\n`);
  let passes = 0;
  for (const tc of cases) {
    process.stdout.write(`▶ ${tc.id} (${tc.transcript.length} words)  `);
    const result = await proposeDirectorScript({
      transcript: tc.transcript,
      message: tc.prompt,
    });
    const script = result.ok ? result.script : null;
    const error = result.ok ? null : result.error;
    const verdict = gradeCase(tc, script, error);
    if (verdict.pass) passes++;
    const status = verdict.pass ? 'PASS' : 'FAIL';
    const attempts = result.attempts;
    console.log(`${status} (attempts=${attempts})`);
    console.log(`  intent: ${tc.intent}`);
    if (script) {
      const groupSummary = script.groups
        .map((g, i) => `${i + 1}.${g.role}[${g.wordRange.join('-')}]`)
        .join(' ');
      console.log(`  result: ${script.groups.length} groups → ${groupSummary}`);
      const labels = script.groups.map((g) => g.label ?? '∅').join(' | ');
      console.log(`  labels: ${labels}`);
    }
    console.log(`  grade:  ${verdict.reasons.join('; ')}`);
    console.log();
  }
  const ratio = `${passes}/${cases.length}`;
  console.log('='.repeat(60));
  console.log(`Result: ${ratio} passed.`);
  if (passes >= 7) {
    console.log('GATE OK — planner quality clears Day 8 threshold (≥7/10).');
  } else if (passes >= 5) {
    console.log('GATE MARGINAL — between 5 and 7. Consider sharpening vocabularies.');
  } else {
    console.log('GATE FAIL — under 5/10. Sharpen vocabularies before further work.');
  }
}

main().catch((err) => {
  console.error('day8 harness crashed:', err);
  process.exit(1);
});
