// Caption stage frame. Owns the theme-derived CSS variables (--lab-bg,
// --lab-ink, --color01..04, --cap-sans, --cap-serif, --word-step) on a
// container element so the role classes inside .lab-caption can resolve them.

import type { CSSProperties, ReactNode } from 'react';
import type { LabRoll } from '../engine/randomizer';

type Props = {
  roll: LabRoll;
  paused: boolean;
  // Bumped on every Roll / Scene change / FX change so the inner caption
  // remounts and replays animations from frame 0.
  mountKey: number;
  children: ReactNode;
};

export function LabStage({ roll, paused, mountKey, children }: Props) {
  const { theme, accents, fontSans, fontSerif, wordStepSec } = roll;
  const accentMap = Object.fromEntries(accents.map((a) => [a.key, a.hex]));
  const style: CSSProperties = {
    ['--lab-bg' as never]: theme.bg,
    ['--lab-ink' as never]: theme.ink,
    ['--color01' as never]: accentMap.c1 ?? theme.c1,
    ['--color02' as never]: accentMap.c2 ?? theme.c2,
    ['--color03' as never]: accentMap.c3 ?? theme.c3,
    ['--color04' as never]: accentMap.c4 ?? theme.c4,
    ['--cap-sans' as never]: fontSans[0],
    ['--cap-serif' as never]: fontSerif[0],
    ['--word-step' as never]: `${wordStepSec}s`,
    ['--letter-step' as never]: '28ms',
  };
  return (
    <div
      key={mountKey}
      className="lab-caption"
      data-paused={paused ? 'true' : 'false'}
      style={style}
    >
      {children}
    </div>
  );
}
