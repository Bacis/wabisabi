import { describe, expect, it } from 'vitest';
import {
  crystalLetterTransform,
  magneticLetterTransform,
  sambaLetterTransform,
} from './letterMath';

// Snapshot-style tests pinning the visually-tuned numeric output. If a
// future "cleanup" PR drifts these constants, the renderer's pixel output
// drifts with them — so we lock them here at representative inputs.

describe('sambaLetterTransform', () => {
  it('returns expected entry-time output for letter 0 at 200ms', () => {
    // Snapshot — locked against the byte-faithful extraction. If this drifts
    // the renderer's pixel output drifts in lockstep.
    expect(sambaLetterTransform(0, 200, 200)).toEqual({
      transform: 'translate(1.14px, -0.85px) scale(0.966, 0.973)',
      opacity: 0.875,
    });
  });

  it('is deterministic for the same inputs', () => {
    const a = sambaLetterTransform(3, 850, 1500);
    const b = sambaLetterTransform(3, 850, 1500);
    expect(a).toEqual(b);
  });

  it('reaches full entry opacity (1.0) at elapsed >= 400ms', () => {
    expect(sambaLetterTransform(0, 400, 0).opacity).toBe(1);
    expect(sambaLetterTransform(0, 1000, 0).opacity).toBe(1);
  });

  it('letter 0 vs letter 5 produce distinct positions at same elapsed time', () => {
    const a = sambaLetterTransform(0, 800, 800);
    const b = sambaLetterTransform(5, 800, 800);
    expect(a.transform).not.toBe(b.transform);
  });
});

describe('crystalLetterTransform', () => {
  it('returns expected entry-time output for letter 0 at 0ms (max scatter)', () => {
    // Snapshot — locks the seedRand(letterIdx*73 + 19) LCG stream + math.
    const out = crystalLetterTransform(0, 0);
    expect(out).toEqual({
      transform: 'translate(-26.63px, 78.62px) rotate(23.4deg) scale(0.400)',
      opacity: 0,
    });
  });

  it('snaps to no displacement and full opacity at elapsed >= 900ms', () => {
    const out = crystalLetterTransform(0, 900);
    expect(out.transform).toBe('translate(0.00px, 0.00px) rotate(0.0deg) scale(1.000)');
    expect(out.opacity).toBe(1);
  });

  it('different letter indices produce different scatter directions', () => {
    expect(crystalLetterTransform(0, 100).transform).not.toBe(crystalLetterTransform(1, 100).transform);
  });
});

describe('magneticLetterTransform', () => {
  it('starts at the origin (factor = 1 × decay) at elapsed = 0 with opacity 0', () => {
    const out = magneticLetterTransform(0, 0);
    // At t=0: decay=e^0=1, osc=cos(0)=1, factor=1 → max displacement
    // opacity = min(1, 0 * 2.5) = 0
    expect(out.opacity).toBe(0);
  });

  it('is deterministic across multiple calls with the same inputs', () => {
    const a = magneticLetterTransform(7, 350);
    const b = magneticLetterTransform(7, 350);
    expect(a).toEqual(b);
  });

  it('opacity ramps to 1.0 by elapsed = 440ms (1100/2.5 = 440)', () => {
    expect(magneticLetterTransform(0, 440).opacity).toBe(1);
    expect(magneticLetterTransform(0, 1100).opacity).toBe(1);
  });

  it('snap-back damping shrinks displacement as elapsed grows', () => {
    const early = magneticLetterTransform(2, 50);
    const late = magneticLetterTransform(2, 1100);
    // Both transforms are stringified — extract the translate magnitudes by
    // parsing. Late should have effectively zero translate (decay ~ 0).
    const lateMatch = late.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    expect(lateMatch).not.toBeNull();
    const [, lx, ly] = lateMatch!;
    expect(Math.abs(parseFloat(lx!))).toBeLessThan(1);
    expect(Math.abs(parseFloat(ly!))).toBeLessThan(1);
    // Early should not be near-zero.
    expect(early.transform).not.toEqual(late.transform);
  });
});
