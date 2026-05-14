# Quality harness — reference-driven Director TDD

When a render looks "boring" or "off-brand", the question is: which specific design moves are reproducible today, and which are renderer/planner gaps?

This harness turns each reference reel into a structured assertion list. Pass = the move is reproducible. Fail = it isn't. Failing-not-shipped = known ticket. Failing-shipped = regression.

## Layout

```
tests/quality/
  references/
    jodie/
      source.mp4         the reference clip (design inspiration only)
      spec.md            human-readable style breakdown (every move documented)
      annotations.json   machine-readable beat catalog
      prompt.txt         the prompt sent to the planner targeting orhan
      expected.json      per-beat structural assertions
      frames/            reference frame stills (documentation only)
  harness/
    types.ts             shared TS types
    assertions.ts        assertion helpers (placement, size, casing, layout, etc.)
    grade.ts             pure grader: DirectorScript + expected → GradeResult
    loadReference.ts     reads references/<name>/{prompt,expected}
    runMocked.ts         Tier 1: loads committed mock, runs through grader
    runLive.ts           Tier 2: calls live planner, optionally refreshes mock
    mocks/
      jodie-on-orhan.json   committed planner output (seeded via Tier 2)
  quality.spec.ts        Vitest entry; turns each beat into one `it` block
```

## Two tiers

### Tier 1 — always-on

```bash
npm test tests/quality/
```

Reads the committed `harness/mocks/<name>-on-orhan.json`, grades it against `expected.json`, prints pass/fail per beat. Skips entirely (with a clear message) when no mock exists yet.

No LLM calls. Free. Catches:
- Translator regressions (`directorScriptToChunkOverrides` mis-mapping fields).
- Schema regressions.
- Assertion-library bugs.

Does NOT catch planner drift — only Tier 2 does.

### Tier 2 — on demand

```bash
# Run all references, print scoreboard, exit non-zero if any non-gap failures.
npm run quality:live

# Just one reference.
npm run quality:live -- jodie

# Refresh the committed mock from the live planner output.
npm run quality:live -- jodie --update-mock
```

Calls the live Director planner (`proposeDirectorScript`) with the reference's `prompt.txt` + the orhan transcript. Costs one Sonnet 4.5 call per reference (~$0.05 with cache hits).

Use to:
- Seed the committed mock for a new reference.
- Verify planner output drift hasn't broken expectations.
- Refresh the mock after a deliberate planner-prompt change.

## Reading the scoreboard

```
▶ jodie → orhan (live)
  8/14 passed · 4 known gaps
  ✓ global · project-font-inter
  ✓ global · project-emphasis-yellow
  ✓ title-open  [shipped]
  ◌ title-char-reveal  [not-shipped]
      · motion-preset-equals: layoutParams.motion "unset" != "char-reveal"
  ✓ chapter-card-stat  [shipped]
  ◌ chapter-card-backdrop  [not-shipped]
      · layout-strategy: layoutStrategy "cascade-stack" != "chapter-card"
  ✓ brand-reveal-heal-man  [shipped]
  ✓ list-disciplines  [shipped]
  ✓ cta-closing  [shipped]
  ◌ poll-card  [not-shipped]
  ◌ font-mix-phrase-stack  [not-shipped]
  ◐ audio-cue-coverage  [partial]
```

Status icons:
- `✓` shipped + passing
- `✗` shipped + FAILING (regression — fix this)
- `◌` not-shipped, failing (known gap, becomes a ticket)
- `◐` partial (schema ships, asset/integration pending)

## TDD loop

1. Author a new reference under `references/<name>/`.
2. Hand-write `expected.json` listing every move; mark each as `shipped` / `partial` / `not-shipped` in the capability field.
3. Run `npm run quality:live -- <name> --update-mock` once to seed the mock.
4. `npm test tests/quality/` becomes the regression net.
5. When you ship a not-shipped capability: flip the relevant beat's `capability` from `not-shipped` to `shipped` and re-run Tier 1 — the test now MUST pass (not just "documented as red").

## When the suite has zero references

Vitest's `describe.skipIf` keeps the file passing by skipping every reference whose mock hasn't been seeded. Run Tier 2 with `--update-mock` once and Tier 1 starts producing real signal.
