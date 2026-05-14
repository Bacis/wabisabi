// Generalized caption placement model. Day 5 of the Director engine refactor.
//
// The original ReelClone reads `styleSpec.layout.position` ('top' | 'middle' |
// 'bottom') + `styleSpec.layout.align` ('left' | 'center' | 'right') and
// translates them inline into CSS top/bottom + justifyContent. That model
// can't express:
//   * baseline-lower-third anchoring (third-vertical landmark, distinct
//     from the safe-margin-bottom origin)
//   * sub-pixel offsets ("nudge the title 3% down")
//   * per-layout placement (cascade-stack anchored bottom, list role
//     anchored baseline-lower-third on the same render)
//
// This file introduces a Placement type the renderer uses uniformly. Old
// presets keep rendering identically because resolvePlacement() maps the
// legacy `position` + `align` fields onto the new model with byte-faithful
// CSS output. Day 6's DirectorScript schema can populate `placement`
// directly per group, and the renderer's caption container reads it
// without needing to know which strategy emitted the layout.

import type React from 'react';

export type PlacementAnchor =
  | 'top'
  | 'middle'
  | 'bottom'
  | 'baseline-lower-third';

export type PlacementAlignment = 'left' | 'center' | 'right';

export type Placement = {
  anchor: PlacementAnchor;
  alignment: PlacementAlignment;
  // Fractions of frame dimensions (0..1). Positive offsetY moves the
  // anchor DOWN regardless of anchor side ('top' anchor + offsetY 0.1 →
  // ten percent below the safe margin; 'bottom' anchor + offsetY 0.1 →
  // ten percent further above the safe margin).
  offsetY?: number;
  offsetX?: number;
};

// ---------------------------------------------------------------------------
// resolvePlacement — read the new `layout.placement` block, falling back
// to legacy `layout.position` / `layout.align` for unmigrated presets.

export function resolvePlacement(styleSpec: Record<string, any>): Placement {
  const layout = styleSpec.layout ?? {};
  const p = layout.placement;
  if (p && typeof p === 'object') {
    return {
      anchor: (p.anchor ?? 'bottom') as PlacementAnchor,
      alignment: (p.alignment ?? 'center') as PlacementAlignment,
      offsetY: typeof p.offsetY === 'number' ? p.offsetY : undefined,
      offsetX: typeof p.offsetX === 'number' ? p.offsetX : undefined,
    };
  }
  // Legacy compat: map position + align onto the new model.
  // Default `align` was 'left' in the pre-placement renderer — preserved.
  return {
    anchor: (layout.position ?? 'bottom') as PlacementAnchor,
    alignment: (layout.align ?? 'left') as PlacementAlignment,
  };
}

// ---------------------------------------------------------------------------
// placementToContainerStyle — produces the caption-container CSS pair.
//
// Byte-faithful with the original renderer for the legacy path (no offsets,
// only top|middle|bottom anchors). Sub-pixel offsets and the new
// baseline-lower-third anchor only kick in when explicitly requested.

export type ContainerStyle = {
  positionStyle: React.CSSProperties;
  justifyContent: 'flex-start' | 'flex-end' | 'center';
};

export function placementToContainerStyle(
  placement: Placement,
  safeMargin: number,
): ContainerStyle {
  const { anchor, alignment, offsetY, offsetX } = placement;
  const safePct = safeMargin * 100;
  const dyPct = (offsetY ?? 0) * 100;
  const dxPct = (offsetX ?? 0) * 100;
  const hasOffsetY = offsetY !== undefined && offsetY !== 0;
  const hasOffsetX = offsetX !== undefined && offsetX !== 0;

  let positionStyle: React.CSSProperties;
  switch (anchor) {
    case 'top':
      positionStyle = hasOffsetX
        ? { top: `${safePct + dyPct}%`, transform: `translateX(${dxPct}%)` }
        : { top: `${safePct + dyPct}%` };
      break;
    case 'middle':
      positionStyle = {
        top: '50%',
        transform:
          hasOffsetX || hasOffsetY
            ? `translate(${dxPct}%, calc(-50% + ${dyPct}%))`
            : 'translateY(-50%)',
      };
      break;
    case 'baseline-lower-third':
      // 2/3 down the frame is the classic broadcast lower-third baseline.
      positionStyle = hasOffsetX
        ? { top: `${66.6667 + dyPct}%`, transform: `translateX(${dxPct}%)` }
        : { top: `${66.6667 + dyPct}%` };
      break;
    case 'bottom':
    default:
      positionStyle = hasOffsetX
        ? { bottom: `${safePct - dyPct}%`, transform: `translateX(${dxPct}%)` }
        : { bottom: `${safePct - dyPct}%` };
  }

  const justifyContent: ContainerStyle['justifyContent'] =
    alignment === 'left'
      ? 'flex-start'
      : alignment === 'right'
        ? 'flex-end'
        : 'center';

  return { positionStyle, justifyContent };
}
