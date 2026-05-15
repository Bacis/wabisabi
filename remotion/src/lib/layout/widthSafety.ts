// Shared safety factor applied to every `len × charAdvance` width estimate
// inside layout strategies. Real Inter Black 900 glyph advance diverges from
// the cheap estimate in two ways:
//
//   1. Heavy weight + tight letterSpacing: uppercase ALL-CAPS lines
//      (RUNNING / PATTERNS) measure ~20-25% wider than the estimate.
//
//   2. Mixed-case lines with heavy capitals (Have, Much, Big) plus
//      wide-glyph bigrams (mu, wh, Ha) measure ~30-40% wider — the capital
//      ascender + the heavy `m`/`w` combo blows past the averaged
//      charAdvance the preset profiles.
//
// 1.4 covers both cases AND the agent-tunable `tier.sizeMultiplier > 1`
// path (the renderer multiplies sizeHint × lineScale × tierSizeMul; the
// estimator can't see the tier slice without plumbing it through, so a
// generous safety factor is the simplest robust answer).
//
// Below ~120px font this margin is harmless; above it, it's the difference
// between a tight stack and a clip at the frame edge.
export const WIDTH_SAFETY = 1.4;
