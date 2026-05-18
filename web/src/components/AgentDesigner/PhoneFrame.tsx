// Cinematic phone-frame wrapper around the Remotion <Player>. Ports the
// prototype's .phone backdrop: bezel + rounded corners + drop shadow +
// scattered stars around the frame + colored halo glow underneath.
//
// The stars sit OUTSIDE the bezel (behind it in z), so they don't overlay
// the actual video. The vignette overlay inside the bezel adds the
// cinematic letterbox feel on top of the Player.

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';
import { useCanvasDims } from '@/lib/editor/coords';

const STAR_COUNT = 48;

export function PhoneFrame({ children, pointOn }: { children: ReactNode; pointOn?: boolean }) {
  const { canvasW, canvasH } = useCanvasDims();
  // Drive the bezel + backdrop aspect-ratio from the source's canvas
  // dims via a CSS custom property. The CSS rules read
  // `aspect-ratio: var(--canvas-aspect, 9/16)`, so the legacy vertical
  // baseline survives if a consumer doesn't set the variable.
  const aspectStyle: CSSProperties = {
    ['--canvas-aspect' as string]: `${canvasW} / ${canvasH}`,
  };

  // Deterministic star scatter so a re-render doesn't shimmer the layout.
  const stars = useMemo(
    () =>
      Array.from({ length: STAR_COUNT }, (_, i) => ({
        x: (i * 173) % 100,
        y: (i * 97) % 100,
        o: 0.18 + ((i * 31) % 100) / 220,
        s: 1 + (i % 3) * 0.6,
      })),
    [],
  );

  return (
    <div
      className={`${styles.previewBackdrop}${pointOn ? ' ' + styles.pointOn : ''}`}
      style={aspectStyle}
    >
      <div className={styles.halo} aria-hidden="true" />
      <div className={styles.stars} aria-hidden="true">
        {stars.map((s, i) => (
          <span
            key={i}
            className={styles.star}
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.s,
              height: s.s,
              opacity: s.o,
            }}
          />
        ))}
      </div>
      <div className={styles.previewFrame}>{children}</div>
    </div>
  );
}
