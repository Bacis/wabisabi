// Track-type legend bar. Sits to the right of the TIMELINE title so the
// user can read what each lane represents at a glance:
//
//   ■ GROUPS       — director scene pills (or "TRANSCRIPT" when no plan yet)
//   ▭ WAVEFORM     — real audio of the source clip
//   ◆ FX CUES      — per-scene audioCue + audioPattern markers (only when
//                    the active DirectorScript has any audio wired in)
//
// Entries hide themselves when the lane is not rendered, so the legend
// always matches the visible stack.

import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

type Entry = {
  id: string;
  swatchClass: string;
  label: string;
  show: boolean;
};

export function TimelineLegend({
  hasDirectorScript,
  hasAudioFx,
}: {
  hasDirectorScript: boolean;
  hasAudioFx: boolean;
}) {
  const entries: Entry[] = [
    {
      id: 'groups',
      swatchClass: styles.legendGroups,
      label: hasDirectorScript ? 'GROUPS' : 'TRANSCRIPT',
      show: true,
    },
    {
      id: 'waveform',
      swatchClass: styles.legendWaveform,
      label: 'WAVEFORM',
      show: true,
    },
    {
      id: 'audiofx',
      swatchClass: styles.legendAudioFx,
      label: 'FX CUES',
      show: hasAudioFx,
    },
  ];

  return (
    <div className={styles.legendBar}>
      {entries
        .filter((e) => e.show)
        .map((e) => (
          <span key={e.id} className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${e.swatchClass}`} />
            <span className={styles.legendLabel}>{e.label}</span>
          </span>
        ))}
    </div>
  );
}
