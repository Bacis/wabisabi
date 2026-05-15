// Director-emitted audio cues + patterns, plotted on their own slim lane.
// One marker per group.audioCue / beat.audioCue at the cue's time
// position; one tinted band per group.audioPattern spanning the group's
// time range. Renders nothing when there is no DirectorScript or no
// audio is wired into the plan — keeps the timeline height stable.

import { useMemo } from 'react';
import { useEditor } from '@/lib/editor/store';
import type { AudioPattern, SonicGesture } from '@/lib/director';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

type CueMarker = {
  id: string;
  pct: number;
  gesture: SonicGesture;
  source: 'group' | 'beat';
  label: string;
};

type PatternBand = {
  id: string;
  leftPct: number;
  widthPct: number;
  pattern: AudioPattern;
};

function patternLabel(p: AudioPattern): string {
  switch (p.type) {
    case 'typewriter':
      return 'typewriter';
    case 'tick-per-word':
      return 'ticks';
    case 'sustained-drone':
      return p.params?.sampleSet ? `drone · ${p.params.sampleSet}` : 'drone';
    case 'rise-build':
      return 'rise';
  }
}

export function AudioFxLane() {
  const transcriptText = useEditor((s) => s.transcriptText);
  const durationSec = useEditor((s) => s.durationSec);
  const directorScript = useEditor((s) => s.directorScript);

  const { cues, bands, hasAny } = useMemo(() => {
    if (!directorScript) return { cues: [], bands: [], hasAny: false };
    const tokens = transcriptText.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || durationSec <= 0) {
      return { cues: [], bands: [], hasAny: false };
    }
    const per = durationSec / tokens.length;
    const wordTime = (idx: number) =>
      Math.max(0, Math.min(tokens.length - 1, idx)) * per;

    const cueList: CueMarker[] = [];
    const bandList: PatternBand[] = [];

    for (const g of directorScript.groups) {
      const [startIdx, endIdx] = g.wordRange;
      const tStart = wordTime(startIdx);
      const tEnd = wordTime(endIdx) + per;
      if (g.audioCue) {
        cueList.push({
          id: `${g.id}-cue`,
          pct: (tStart / durationSec) * 100,
          gesture: g.audioCue.gesture,
          source: 'group',
          label: `${g.label ?? g.role} · ${g.audioCue.gesture}`,
        });
      }
      if (g.audioPattern) {
        bandList.push({
          id: `${g.id}-band`,
          leftPct: (tStart / durationSec) * 100,
          widthPct: ((tEnd - tStart) / durationSec) * 100,
          pattern: g.audioPattern,
        });
      }
    }
    for (const b of directorScript.beats) {
      if (!b.audioCue) continue;
      const tStart = wordTime(b.wordRange[0]);
      cueList.push({
        id: `${b.id}-cue`,
        pct: (tStart / durationSec) * 100,
        gesture: b.audioCue.gesture,
        source: 'beat',
        label: `beat · ${b.audioCue.gesture}`,
      });
    }
    return {
      cues: cueList,
      bands: bandList,
      hasAny: cueList.length + bandList.length > 0,
    };
  }, [directorScript, transcriptText, durationSec]);

  if (!hasAny) return null;

  return (
    <div className={`${styles.ctlLane} ${styles.audioFx}`}>
      {bands.map((b) => (
        <div
          key={b.id}
          className={styles.audioFxBand}
          style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
          title={`pattern · ${b.pattern.type}`}
        >
          <span className={styles.audioFxBandLabel}>{patternLabel(b.pattern)}</span>
        </div>
      ))}
      {cues.map((c) => (
        <div
          key={c.id}
          className={`${styles.audioFxCue}${
            c.source === 'beat' ? ' ' + styles.beat : ''
          }`}
          style={{ left: `${c.pct}%` }}
          title={c.label}
        >
          <span className={styles.audioFxDiamond} aria-hidden="true" />
          <span className={styles.audioFxGesture}>{c.gesture}</span>
        </div>
      ))}
    </div>
  );
}
