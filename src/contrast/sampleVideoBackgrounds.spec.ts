import { describe, expect, it, vi } from 'vitest';
import { directorScriptSchema } from '../shared/director/schema.js';
import {
  sampleBackgroundsForGroups,
  type ExtractRawFrameFn,
} from './sampleVideoBackgrounds.js';

// Day 15 — render-side per-group sampling tests. The ffmpeg shell-out
// itself is tested indirectly via the buffer-shape guard; here we test
// the orchestration with a stub extractFn.

const solidRgba = (w: number, h: number, [r, g, b]: [number, number, number]) => {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    buf[off] = r; buf[off + 1] = g; buf[off + 2] = b; buf[off + 3] = 255;
  }
  return buf;
};

const script = directorScriptSchema.parse({
  project: { emphasisFill: '#ffd100', fill: '#ffffff' },
  groups: [
    { id: 'g1', role: 'intro-hook',  wordRange: [0, 2] },
    { id: 'g2', role: 'cta-overlay', wordRange: [3, 5] },
  ],
  beats: [],
});

const wordTimingsSec = [0, 0.5, 1.0, 1.5, 2.0, 2.5];

const videoMeta = { width: 1080, height: 1920, duration: 5.0 };

describe('sampleBackgroundsForGroups', () => {
  it('spreads N frame extractions across each group and averages the result', async () => {
    const extractFn: ExtractRawFrameFn = vi.fn(async ({ timeSec }) => {
      // First group → pure black bg, second group → pure white bg.
      const isFirst = timeSec < 1.5;
      return solidRgba(16, 16, isFirst ? [0, 0, 0] : [255, 255, 255]);
    });
    const out = await sampleBackgroundsForGroups({
      videoPath: '/fake.mp4',
      videoMeta,
      script,
      wordTimingsSec,
      extractFn,
      samplesPerGroup: 3,
    });
    expect(out['g1']).toBe('#000000');
    expect(out['g2']).toBe('#ffffff');
    // Each group was sampled samplesPerGroup times.
    expect(extractFn).toHaveBeenCalledTimes(6);
  });

  it('crops to the lower-third safe area by default', async () => {
    const calls: Array<{ x: number; y: number; w: number; h: number }> = [];
    const extractFn: ExtractRawFrameFn = async ({ crop }) => {
      calls.push(crop);
      return solidRgba(16, 16, [128, 128, 128]);
    };
    await sampleBackgroundsForGroups({
      videoPath: '/fake.mp4',
      videoMeta,
      script,
      wordTimingsSec,
      extractFn,
      samplesPerGroup: 1,
    });
    for (const c of calls) {
      // Default crop is x 5..95%, y 55..95% of frame.
      expect(c.x).toBeCloseTo(0.05 * videoMeta.width, 0);
      expect(c.y).toBeCloseTo(0.55 * videoMeta.height, 0);
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
    }
  });

  it('clamps requested times into the video duration', async () => {
    const calls: number[] = [];
    const extractFn: ExtractRawFrameFn = async ({ timeSec }) => {
      calls.push(timeSec);
      return solidRgba(16, 16, [0, 0, 0]);
    };
    await sampleBackgroundsForGroups({
      videoPath: '/fake.mp4',
      videoMeta: { ...videoMeta, duration: 1.0 }, // very short clip
      script,
      wordTimingsSec: [0, 5, 10, 15, 20, 25], // way past duration
      extractFn,
      samplesPerGroup: 2,
    });
    for (const t of calls) {
      expect(t).toBeLessThanOrEqual(0.95);
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it('skips frame failures gracefully and continues sampling', async () => {
    let calls = 0;
    const extractFn: ExtractRawFrameFn = async () => {
      calls++;
      if (calls === 2) throw new Error('simulated ffmpeg failure');
      return solidRgba(16, 16, [0, 0, 0]);
    };
    const out = await sampleBackgroundsForGroups({
      videoPath: '/fake.mp4',
      videoMeta,
      script,
      wordTimingsSec,
      extractFn,
      samplesPerGroup: 3,
    });
    // g1 still produces a sample from the other 2 frames.
    expect(out['g1']).toBeDefined();
  });

  it('omits a group from the output when every frame failed', async () => {
    const extractFn: ExtractRawFrameFn = async () => {
      throw new Error('always fails');
    };
    const out = await sampleBackgroundsForGroups({
      videoPath: '/fake.mp4',
      videoMeta,
      script,
      wordTimingsSec,
      extractFn,
      samplesPerGroup: 2,
    });
    expect(out['g1']).toBeUndefined();
    expect(out['g2']).toBeUndefined();
  });
});
