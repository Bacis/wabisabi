import { StyleSpecSchema, type StyleSpec } from '../styleSpec.js';

// Stylepack composer — merges DeepPartial<StyleSpec> partials in order,
// then runs StyleSpecSchema.parse() once at the end so all defaults apply
// in a single pass. Three rules:
//
//   1. Plain objects → recursive merge, later wins.
//   2. Arrays → REPLACE whole. Critical for color.emphasisFill palettes —
//      concat would silently grow the palette beyond what the preset author
//      intended.
//   3. Discriminator-aware replace for `reel.layout`, `reel.motion.entry`,
//      `reel.motion.exit`, and per-tier `reel.fx.tiers.<key>`: when the
//      discriminator field (strategy / preset / effect) changes, replace
//      the whole node — params from the previous variant are nonsense for
//      the new one.
//
// Replaces the existing two-level mergeStyleSpec at presets.ts:123-145 (Phase
// 7 of the pipeline refactor). Old shape stays callable for now; presets.ts
// migrates incrementally.

export type DeepPartial<T> = T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepPartial<U>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type StylepackPartial = DeepPartial<StyleSpec>;

// Paths whose merge requires checking a discriminator field. The path is a
// dot-separated string for readability; the matcher compares pathSoFar joined
// the same way. fx.tiers.<dynamic> is handled separately because the tier
// key is dynamic (p0, p1, italic).
const DISCRIMINATED_PATHS: ReadonlyArray<{ path: string; discriminator: string }> = [
  { path: 'reel.layout', discriminator: 'strategy' },
  { path: 'reel.motion.entry', discriminator: 'preset' },
  { path: 'reel.motion.exit', discriminator: 'preset' },
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function joinPath(p: ReadonlyArray<string>): string {
  return p.join('.');
}

function isFxTierAssignmentPath(p: ReadonlyArray<string>): boolean {
  return p.length === 4 && p[0] === 'reel' && p[1] === 'fx' && p[2] === 'tiers';
}

function mergeAt(base: unknown, override: unknown, pathSoFar: ReadonlyArray<string>): unknown {
  if (override === undefined) return base;
  if (base === undefined) return override;

  // Discriminator-aware replace at known paths.
  const here = joinPath(pathSoFar);
  for (const rule of DISCRIMINATED_PATHS) {
    if (here === rule.path && isPlainObject(base) && isPlainObject(override)) {
      const a = base[rule.discriminator];
      const b = override[rule.discriminator];
      if (b !== undefined && a !== b) return override;
      break;
    }
  }

  // fx.tiers.<tierKey>: when the override's effect id differs from base's,
  // replace the assignment whole. Array values always replace (stacked
  // effect lists don't merge field-by-field).
  if (isFxTierAssignmentPath(pathSoFar)) {
    if (Array.isArray(override) || Array.isArray(base)) return override;
    if (isPlainObject(base) && isPlainObject(override)) {
      if (override.effect !== undefined && override.effect !== base.effect) return override;
    }
  }

  // Arrays always replace.
  if (Array.isArray(override)) return override;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  // Plain objects: recursive merge.
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(override)) {
    out[k] = mergeAt(base[k], override[k], [...pathSoFar, k]);
  }
  return out;
}

export function compose(...partials: ReadonlyArray<StylepackPartial>): StyleSpec {
  let acc: unknown = {};
  for (const p of partials) acc = mergeAt(acc, p, []);
  return StyleSpecSchema.parse(acc);
}

// Looser variant — merges without the final schema parse. Used by the agent
// stage when accumulating a draftPatch that will be sent back to the client
// (the client's editor store applies + validates on its end).
export function composePartial(...partials: ReadonlyArray<StylepackPartial>): StylepackPartial {
  let acc: unknown = {};
  for (const p of partials) acc = mergeAt(acc, p, []);
  return acc as StylepackPartial;
}
