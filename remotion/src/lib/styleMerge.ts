// Two-level deep merge for StyleSpec-shaped objects. The top level is
// keys like font/color/layout/animation; each value is a flat object. We
// don't need full recursion — that would also incorrectly merge arrays
// or primitives we want to replace wholesale (e.g. a palette array).
//
// Shared between PopWords and SingleWord for Phase C's chunk-level style
// overrides. Mirror of `mergeStyleSpec` in src/shared/presets.ts (can't
// directly import across the remotion/ bundle boundary).
export function mergeStyleSpec(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overrideVal = override[key];
    if (
      baseVal &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      overrideVal &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal)
    ) {
      out[key] = { ...(baseVal as object), ...(overrideVal as object) };
    } else if (overrideVal !== undefined) {
      out[key] = overrideVal;
    }
  }
  return out;
}

export type ChunkOverride = {
  range: [number, number];
  overrides: Record<string, unknown>;
};

// Walk the override list in order and merge any entry whose `range`
// contains the given chunk index. Later entries win over earlier ones,
// matching the API-side preset → user merge order. Returns a new object;
// never mutates input.
export function resolveChunkStyle(
  chunkIdx: number,
  baseSpec: Record<string, unknown>,
  overrides: ChunkOverride[] | undefined,
): Record<string, unknown> {
  if (!overrides || overrides.length === 0) return baseSpec;
  let result: Record<string, unknown> = baseSpec;
  for (const o of overrides) {
    const [start, end] = o.range;
    if (chunkIdx >= start && chunkIdx <= end) {
      result = mergeStyleSpec(result, o.overrides);
    }
  }
  return result;
}
