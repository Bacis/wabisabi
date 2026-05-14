import React from 'react';
import { FxFilter, type Vol03Effect } from './svgFilters';

// Renders a hidden <svg><defs> tree containing one <filter> per requested
// (tierKey, effect) pair. Lifted from ReelClone so any future template that
// uses Vol.03 filters can emit defs the same way.

export type FxRequest = {
  id: string;
  effect: Vol03Effect;
  intensity: number;
  tierFillHex: string;
};

export function FxFilterDefs({
  requests,
  frameSec,
}: {
  requests: FxRequest[];
  frameSec: number;
}) {
  if (requests.length === 0) return null;
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        {requests.map((r) => (
          <FxFilter
            key={r.id}
            id={r.id}
            effect={r.effect}
            intensity={r.intensity}
            frameSec={frameSec}
            tierFillHex={r.tierFillHex}
          />
        ))}
      </defs>
    </svg>
  );
}
