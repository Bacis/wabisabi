# ReelClone — Intensity-Driven Body Motion FX (FX Lab Vol.03)

Date: 2026-05-08
Status: Approved (section-by-section), implementation pending

## Goal

Add six new SVG-filter-based kinetic effects to ReelClone, exposed per-tier
in the dashboard, each driven by a single 0..1 `intensity` parameter that
scales both amplitude and rate of the effect. Effects come from FX Lab Vol.03:

| Id           | Name        | Primitive stack                                            |
| ------------ | ----------- | ---------------------------------------------------------- |
| `resonance`  | Resonance   | dual `feDisplacementMap` + sine-driven scale               |
| `plasma`     | Plasma Core | `feTurbulence` → heat `feComponentTransfer` → `feComposite operator=in` → `feMerge` |
| `inflation`  | Inflation   | `feMorphology operator=dilate` + sine breath + group scale |
| `slice`      | Slice Glitch | 10 horizontal-band stacked copies + per-band offset       |
| `ferro`      | Ferrofluid  | dilate halo + `feComposite operator=out` + high-freq turbulence + displacement + flood |
| `shockwave`  | Shockwave   | `feTurbulence` + displacement, `\|sin(t·ω)\|` pulse driver |

## Non-goals

- Audio-amplitude-driven intensity (planned for V2; intensity is static per-tier for V1).
- Sub-parameter exposure (frequency vs amplitude are coupled to the single `intensity` slider — that's the whole point).
- Theme-preset coverage (existing themes keep `effect: 'none'` defaults; new presets can opt in).
- Replacing the existing six per-letter effects (`samba`/`breathe`/`flare`/`crystal`/`magnetic`).

## Schema changes

`TierStyle` (in `remotion/src/templates/ReelClone.tsx`) gains:

```ts
type EffectId =
  | 'none' | 'samba' | 'breathe' | 'flare' | 'crystal' | 'magnetic'
  | 'resonance' | 'plasma' | 'inflation' | 'slice' | 'ferro' | 'shockwave';

type TierStyle = {
  // ...existing fields
  effect?: EffectId;
  intensity?: number;  // 0..1, default 0.5 — only meaningful for the new six
};
```

`styleSpec.reel` is already `z.record(z.string(), z.any())`, so no Zod schema
changes are needed. Existing presets keep rendering identically (no `intensity`
field → field is `undefined` → only relevant when an intensity-driven effect
is also selected).

## Render strategy

### Five filter-based effects (resonance, plasma, inflation, ferro, shockwave)

- Inline a single `<svg width="0" height="0" style="position:absolute"><defs>…</defs></svg>`
  at the AbsoluteFill root, containing one `<filter>` per `(tierKey, effect)`
  combination that the **active chunk's tiers actually use**. Filter IDs:
  `fx-${tierKey}-${effect}` where `tierKey ∈ {'p0', 'p1', 'italic'}`.
- All filter primitive attributes (`scale`, `radius`, `seed`, `baseFrequency`,
  `flood-color`, etc.) are computed per-frame from `useCurrentFrame()` +
  `intensity` and inlined into the SVG defs each render. React handles the
  diff; deterministic across Player and Lambda.
- Filter region enlarged on every filter: `x="-30%" y="-50%" width="160%" height="200%"`
  so displacement / spike / shockwave can extend beyond the glyph bbox.
- The existing per-word `<span>` gets `style.filter = 'url(#fx-…)'`. Existing
  layout, typography, tier fills, gradients, and entry spring all remain
  untouched — the SVG filter is a post-process on the rasterized glyph.

### Slice glitch (structural)

Slice cannot be expressed as a single filter (it needs per-band horizontal
clipping with independent offsets). When `tier.effect === 'slice'`:

- Bypass the existing per-letter render branch.
- Render the word as 10 stacked `<span>` copies inside a relatively-positioned
  `<span>` wrapper. Each copy gets:
  - `position: absolute; top: 0; left: 0`
  - `clipPath: inset(<topPx> 0 <botPx> 0)` — sliced into 10 horizontal bands
  - `transform: translateX(<offsetPx>)` — per-band offset
- Per-frame deterministic band randomness (mirrors demo's `bandRand(i, tick)`):
  `tickMs = 200 - I·170`; `tick = floor((frame/fps)·1000 / tickMs)`;
  `r = LCG(i*9173 ^ tick*31337)`.
- Stillness probability `0.4 + I·0.55` per band per tick.
- At `I > 0.6` and `|offset| > 4`, alternating bands tint cool (`#4dd4ff`) /
  hot (`#ff5b3c`) for chromatic noise.

## Per-effect math

All math is straight from the demo. `t = frame / fps` (seconds), `I` ∈ [0, 1].

### Resonance
- `feTurbulence` × 2: `seed₁ = floor(t·6) % 200`, `seed₂ = floor(t·9) % 200`,
  baseFrequency `0.018` and `0.06`.
- `feDisplacementMap` × 2:
  - `scale₁ = I·18 · sin(t·(5 + I·8))`
  - `scale₂ = I·10 · sin(t·(14 + I·18) + 1.7)`

### Plasma Core
- `feTurbulence` baseFrequency `(0.018 + I·0.012) (0.025 + I·0.018)`,
  seed `floor(t · (1 + I·4))`.
- `feComponentTransfer` heat ramp (hardcoded tableValues per demo).
- `feComposite operator="in"` against `SourceGraphic` masks plasma to glyph.
- `feColorMatrix` alpha multiplier = `min(1, I·1.1)`.
- `feMerge` puts plasma over `SourceGraphic`.

### Inflation
- `breathRate = 1.6 + I·3.0` (rad/s)
- `breathPhase = sin(t · breathRate)`
- `feMorphology dilate` radius `= max(0, I·0.4 + breathPhase·(0.05 + I·0.4))`
- Group `transform: scale(1 + breathPhase · I · 0.04)` on a wrapper around
  the filtered span.

### Slice Glitch
See "Render strategy / Slice" above.

### Ferrofluid
- `feMorphology dilate` radius `= 0.5 + I·7.5`
- `feComposite operator="out"` (dilated, SourceGraphic) → halo only
- `feTurbulence` baseFrequency `= 0.35 + I·0.4`,
  seed `= floor(t · (8 + I·30)) % 250`
- `feDisplacementMap` scale `= I·28` → spikes
- `feFlood`: linear blend tier-fill → `#ff5b3c` as `I → 1`
- `feMerge` spikes over `SourceGraphic`

### Shockwave
- `omega = 9 + I·50` (rad/s)
- `pulse = |sin(t · omega)|`
- `feDisplacementMap` scale `= pulse · I · 32`
- `feTurbulence` baseFrequency `= 0.018 + I·0.04`,
  seed `= floor(t·2) % 200`

## File changes

### `remotion/src/templates/ReelClone.tsx`

- Extend `EffectId` union and `TierStyle.intensity?: number`.
- Add `computeFxAttrs(effect, intensity, frameSec)` helper that returns the
  attribute bag for each filter primitive.
- Render `<FxFilterDefs activeTiers={…} frameSec={t} />` once at AbsoluteFill
  root. Iterates over the (tier, effect) pairs actually used in the active
  chunk so we don't emit 18 unused filter defs every frame.
- In the per-word render branch, after the existing tier resolution:
  - If `effect ∈ {resonance, plasma, inflation, ferro, shockwave}`: keep the
    existing single-span path; add `filter: 'url(#fx-${tierKey}-${effect})'`
    to `wordExtras`.
  - If `effect === 'slice'`: branch to `<SliceWord text={text} I={intensity}
    frameSec={t} fontStyles={fontStyles} fillStyles={fillStyles} />`.
  - For `'inflation'` only: also wrap in a group span carrying the
    `transform: scale(…)` for the whole-word breath.
  - All other effect values (`'none'` or existing six): unchanged.

### `web/src/lib/templateDescriptors/reel-clone.ts`

- Append six new effect options to the `tierGroup` dropdown:
  ```
  { value: 'resonance', label: 'Resonance — dual-frequency vibration (intensity)' },
  { value: 'plasma',    label: 'Plasma Core — heat fill flow (intensity)' },
  { value: 'inflation', label: 'Inflation — dilate breathe (intensity)' },
  { value: 'slice',     label: 'Slice Glitch — banded offsets (intensity)' },
  { value: 'ferro',     label: 'Ferrofluid — magnetic spike halo (intensity)' },
  { value: 'shockwave', label: 'Shockwave — pulsed distortion (intensity)' },
  ```
- Add an `intensity` slider control to `tierGroup`:
  ```
  {
    kind: 'slider',
    path: `${pathPrefix}.intensity`,
    label: 'Intensity',
    min: 0, max: 1, step: 0.01, default: 0.5,
    showIf: { path: `${pathPrefix}.effect`, oneOf:
      ['resonance', 'plasma', 'inflation', 'slice', 'ferro', 'shockwave'] },
  }
  ```

### `web/src/lib/types.ts`

- Add `showIf?: { path: string; oneOf: string[] }` to the `Control` base type.

### `web/src/components/Form/ControlRenderer.tsx`

- Before rendering each control, evaluate `showIf` against the current
  styleSpec via `dotPath`; if `value ∉ oneOf`, return null.

### `src/shared/styleSpec.ts`

- No changes. `reel` field already accepts arbitrary keys.

## Backward compatibility

- Existing presets and themes default to `effect: 'none'`. `intensity` field
  is `undefined` and ignored.
- Existing samba / breathe / flare / crystal / magnetic effects unchanged —
  they remain in the dropdown and render identically.
- The new `showIf` mechanism is opt-in per control; controls without it
  render unconditionally as today.

## Testing

- **Visual smoke (Player):** load each of the six effects via the dashboard,
  scrub the player, sweep intensity 0 → 1, verify (a) no console errors,
  (b) filter visibly applies, (c) intensity slider produces continuous
  visual change.
- **Render parity (Lambda/local job):** drive `POST /jobs` per the
  `feedback_render_via_api` memory — pick a short sample, set tier 0 effect
  = `resonance`, intensity = 0.7, verify the produced MP4 shows the effect
  on the primary-emphasis words.
- **Determinism check:** render the same job twice, verify hashes match
  (filter primitive seeds are derived from frame, not Math.random).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| `filter: url()` referencing inline SVG defs sometimes fails in headless Chrome at scale | Defs live inside the same SVG document fragment as the rendered tree; verified pattern in Remotion examples. Smoke-test in Lambda before declaring done. |
| Per-frame React diff of filter attrs is a perf concern | Only filters for tiers actively used in the current chunk are emitted (≤3). Numeric attribute updates are cheap. |
| Slice glitch's stacked clip-path copies multiply DOM nodes by 10 per slice word | Only emphasis-tier words at `effect: 'slice'` are affected. Cap is 1 word × 10 spans per chunk in practice. |
| Plasma's hardcoded heat ramp ignores tier fill | Documented as intentional; tier fill paints the base layer behind the plasma overlay. V2 could expose the heat ramp. |
