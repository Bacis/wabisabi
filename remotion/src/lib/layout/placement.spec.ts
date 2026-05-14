import { describe, expect, it } from 'vitest';
import {
  placementToContainerStyle,
  resolvePlacement,
} from './placement';

// Day 5 — placement tests. Verifies:
//   1. Legacy `position` + `align` map onto the new Placement model
//   2. Legacy path emits byte-faithful CSS (no transform on top/bottom
//      anchors when there are no offsets)
//   3. baseline-lower-third anchor produces the broadcast-third Y position
//   4. Offsets compose correctly per anchor (positive offsetY moves DOWN
//      regardless of anchor side)

describe('resolvePlacement — legacy backwards-compat', () => {
  it('maps unset spec to bottom + left (legacy defaults)', () => {
    expect(resolvePlacement({})).toEqual({ anchor: 'bottom', alignment: 'left' });
  });

  it('maps layout.position + layout.align onto the new model', () => {
    expect(resolvePlacement({ layout: { position: 'top', align: 'center' } }))
      .toEqual({ anchor: 'top', alignment: 'center' });
    expect(resolvePlacement({ layout: { position: 'middle', align: 'right' } }))
      .toEqual({ anchor: 'middle', alignment: 'right' });
  });

  it('prefers layout.placement over legacy fields when both are set', () => {
    const got = resolvePlacement({
      layout: {
        position: 'top',
        align: 'left',
        placement: { anchor: 'baseline-lower-third', alignment: 'center', offsetY: 0.05 },
      },
    });
    expect(got).toEqual({
      anchor: 'baseline-lower-third',
      alignment: 'center',
      offsetY: 0.05,
      offsetX: undefined,
    });
  });
});

describe('placementToContainerStyle — byte-faithful legacy CSS', () => {
  it('top anchor emits { top: "15%" } only — no transform', () => {
    const got = placementToContainerStyle({ anchor: 'top', alignment: 'left' }, 0.15);
    expect(got.positionStyle).toEqual({ top: '15%' });
    expect(got.justifyContent).toBe('flex-start');
  });

  it('bottom anchor emits { bottom: "15%" } only — no transform', () => {
    const got = placementToContainerStyle({ anchor: 'bottom', alignment: 'left' }, 0.15);
    expect(got.positionStyle).toEqual({ bottom: '15%' });
    expect(got.justifyContent).toBe('flex-start');
  });

  it('middle anchor emits { top: "50%", transform: "translateY(-50%)" }', () => {
    const got = placementToContainerStyle({ anchor: 'middle', alignment: 'center' }, 0.15);
    expect(got.positionStyle).toEqual({
      top: '50%',
      transform: 'translateY(-50%)',
    });
    expect(got.justifyContent).toBe('center');
  });
});

describe('placementToContainerStyle — new anchors and offsets', () => {
  it('baseline-lower-third anchors at 66.67% of frame height', () => {
    const got = placementToContainerStyle(
      { anchor: 'baseline-lower-third', alignment: 'center' },
      0.15,
    );
    expect(got.positionStyle.top).toMatch(/^66\.6667/);
  });

  it('positive offsetY on top anchor moves the caption further down', () => {
    const got = placementToContainerStyle(
      { anchor: 'top', alignment: 'left', offsetY: 0.05 },
      0.15,
    );
    expect(got.positionStyle).toEqual({ top: '20%' });
  });

  it('positive offsetY on bottom anchor moves the caption further up', () => {
    const got = placementToContainerStyle(
      { anchor: 'bottom', alignment: 'left', offsetY: 0.05 },
      0.15,
    );
    expect(got.positionStyle).toEqual({ bottom: '10%' });
  });

  it('alignment maps to justifyContent', () => {
    expect(
      placementToContainerStyle({ anchor: 'bottom', alignment: 'left' }, 0.15).justifyContent,
    ).toBe('flex-start');
    expect(
      placementToContainerStyle({ anchor: 'bottom', alignment: 'right' }, 0.15).justifyContent,
    ).toBe('flex-end');
    expect(
      placementToContainerStyle({ anchor: 'bottom', alignment: 'center' }, 0.15).justifyContent,
    ).toBe('center');
  });
});
