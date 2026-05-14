// `npm run quality:live` entrypoint. Drives the live Director planner
// against each reference and prints a scoreboard. With --update-mock,
// commits the planner's output to tests/quality/harness/mocks/ so the
// Tier 1 vitest spec can read it.
//
// Usage:
//   npx tsx scripts/quality-live.ts              # all references
//   npx tsx scripts/quality-live.ts jodie        # one reference
//   npx tsx scripts/quality-live.ts jodie --update-mock

import 'dotenv/config';
import { runLive } from '../tests/quality/harness/runLive.js';
import type { GradeResult } from '../tests/quality/harness/types.js';

const REFERENCES = ['jodie'] as const;

type Args = { references: string[]; updateMock: boolean };

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const updateMock = args.includes('--update-mock');
  const refs = args.filter((a) => !a.startsWith('--'));
  return {
    references: refs.length > 0 ? refs : [...REFERENCES],
    updateMock,
  };
}

function formatResult(r: GradeResult): string {
  const lines: string[] = [];
  const { reference, target, source, summary } = r;
  lines.push(
    `▶ ${reference} → ${target} (${source}) — ${summary.passed}/${summary.total} passed · ${summary.knownGaps} known gaps`,
  );
  for (const g of r.globals) {
    const icon = g.passed ? '✓' : g.capability === 'not-shipped' ? '◌' : '✗';
    const tag = g.capability === 'not-shipped' ? '[KNOWN GAP] ' : '';
    lines.push(`  ${icon} global · ${g.id} ${tag}${g.passed ? '' : `\n      · ${g.reason}`}`);
  }
  for (const b of r.beats) {
    const icon = b.passed
      ? '✓'
      : b.capability === 'not-shipped'
        ? '◌'
        : b.capability === 'partial'
          ? '◐'
          : '✗';
    const tag =
      b.capability === 'not-shipped' ? '[KNOWN GAP] ' : b.capability === 'partial' ? '[PARTIAL] ' : '';
    lines.push(`  ${icon} ${b.id} — ${b.description} ${tag}`.trimEnd());
    if (!b.passed) {
      for (const f of b.failed) {
        lines.push(`      · ${f.assertion.kind}: ${f.reason}`);
      }
      if (b.knownGapNote) {
        lines.push(`      → ${b.knownGapNote}`);
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  let nonGapFailures = 0;

  for (const name of args.references) {
    process.stdout.write(`running live planner for "${name}" …\n`);
    let result: GradeResult;
    try {
      result = await runLive({
        reference: name,
        target: 'orhan',
        updateMock: args.updateMock,
      });
    } catch (err) {
      console.error(`✗ ${name}: ${(err as Error).message}`);
      nonGapFailures++;
      continue;
    }
    console.log(formatResult(result));
    console.log();

    const realFailures =
      result.globals.filter((g) => !g.passed && g.capability !== 'not-shipped').length +
      result.beats.filter((b) => !b.passed && b.capability !== 'not-shipped').length;
    nonGapFailures += realFailures;

    if (args.updateMock) {
      console.log(`  ↳ mock updated at tests/quality/harness/mocks/${name}-on-orhan.json`);
    }
  }

  if (nonGapFailures > 0) {
    console.log(`\n${nonGapFailures} non-gap assertion${nonGapFailures === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }
  console.log('\nAll non-gap assertions passed.');
}

main().catch((err) => {
  console.error('quality:live crashed:', err);
  process.exit(1);
});
