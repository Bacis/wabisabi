// Width math shared by every cinematic caption template. The triple
// (`usableWidth`, `charAdvance`, `maxSizeForWord`) was hand-inlined at the
// top of every render function; centralizing it means future templates and
// the layout strategy registry compute glyph budgets the same way.
//
// The factory shape lets callers destructure into existing variable names
// without touching downstream call sites:
//   const { usableWidth: USABLE_WIDTH, charAdvance: CHAR_ADVANCE, maxSizeForWord }
//     = makeSizing({ frameWidth, maxWidthPercent, charAdvance: styleSpec.charAdvance });

export type SizingOptions = {
  // Width of the rendering canvas in pixels.
  frameWidth: number;
  // 0-100 — the fraction of frameWidth the caption container is allowed to
  // occupy. Anything outside USABLE_WIDTH triggers a line break or a shrink.
  maxWidthPercent: number;
  // Empirically measured glyph advance ratio (bbox width / (text length ×
  // font height)) for the font + letterSpacing combo this preset uses.
  // Default 0.58 was a conservative generic value that under-sized Inter
  // Black at tight letterSpacing; presets profile their actual font and
  // pass the measured value here.
  charAdvance?: number | null;
};

export type Sizing = {
  usableWidth: number;
  charAdvance: number;
  // Returns the maximum font size at which a word of `len` characters still
  // fits within usableWidth. `Infinity` for empty inputs so downstream
  // `Math.min(rawSize, maxSizeForWord(0), …)` short-circuits cleanly.
  maxSizeForWord(len: number): number;
};

const DEFAULT_CHAR_ADVANCE = 0.58;

export function makeSizing(opts: SizingOptions): Sizing {
  const usableWidth = opts.frameWidth * (opts.maxWidthPercent / 100);
  const charAdvance = typeof opts.charAdvance === 'number' ? opts.charAdvance : DEFAULT_CHAR_ADVANCE;
  return {
    usableWidth,
    charAdvance,
    maxSizeForWord(len: number): number {
      return len > 0 ? usableWidth / (len * charAdvance) : Infinity;
    },
  };
}
