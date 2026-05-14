// Caption-focused timeline. Mirrors the prototype's word-pill lane + audio
// peak lane below a ruler, with an amber playhead. Replaces the imported
// CaptionDesigner Timeline on /agent/new — the agent flow does not edit
// video/overlay tracks, only captions, so this trimmed surface fits better.
//
// Color assignment: the StyleSpec's emphasisFill palette + a default
// filler color are used to tint word pills, mimicking the prototype's
// variant coloring. Emphasis is inferred by word length + hashtag/at
// markers, matching the same heuristic the ReelClone template uses when
// inferEmphasis is on.

import { useMemo } from 'react';
import { useEditor } from '@/lib/editor/store';
import { Icon } from '@/components/AgentChatPane/Icon';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';
import { TimelineGroupsLane } from './TimelineGroupsLane';

const DEFAULT_FILLER = '#fcd34d'; // amber (matches prototype --v0)
const DEFAULT_EMPHASIS_PALETTE = ['#fb923c', '#f87171', '#c084fc', '#38bdf8'];

function looksLikeEmphasis(word: string): boolean {
  const w = word.replace(/[.,!?;:]+$/, '');
  if (w.startsWith('#') || w.startsWith('@')) return true;
  // Long words tend to carry weight in the prototype's heuristic.
  return w.length >= 5;
}

function getPalette(styleSpec: Record<string, unknown>): {
  filler: string;
  emphasis: string[];
} {
  const color = (styleSpec.color as Record<string, unknown> | undefined) ?? {};
  const fill = typeof color.fill === 'string' ? (color.fill as string) : DEFAULT_FILLER;
  const ef = color.emphasisFill;
  let emphasis: string[];
  if (Array.isArray(ef)) {
    emphasis = (ef as unknown[]).filter((c) => typeof c === 'string') as string[];
  } else if (typeof ef === 'string') {
    emphasis = [ef];
  } else {
    emphasis = DEFAULT_EMPHASIS_PALETTE;
  }
  if (emphasis.length === 0) emphasis = DEFAULT_EMPHASIS_PALETTE;
  return { filler: fill, emphasis };
}

type TLWord = {
  idx: number;
  text: string;
  t: number;
  d: number;
  color: string;
};

export function CinematicTimeline() {
  const transcriptText = useEditor((s) => s.transcriptText);
  const durationSec = useEditor((s) => s.durationSec);
  const currentTime = useEditor((s) => s.currentTime);
  const styleSpec = useEditor((s) => s.styleSpec);
  const seek = useEditor((s) => s.seek);
  const selectedWord = useEditor((s) => s.selectedWord);
  const selectWordForAgent = useEditor((s) => s.selectWordForAgent);

  const words = useMemo<TLWord[]>(() => {
    const tokens = transcriptText
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (tokens.length === 0 || durationSec <= 0) return [];
    const per = durationSec / tokens.length;
    const { filler, emphasis } = getPalette(styleSpec);
    let emphasisI = 0;
    return tokens.map((text, idx) => {
      const isEm = looksLikeEmphasis(text);
      let color = filler;
      if (isEm) {
        color = emphasis[emphasisI % emphasis.length] ?? filler;
        emphasisI++;
      }
      return {
        idx,
        text,
        t: idx * per,
        d: per,
        color,
      };
    });
  }, [transcriptText, durationSec, styleSpec]);

  // Audio peaks — decorative groupings clustered around every 3rd word for
  // visual rhythm. We don't have real audio analysis at this layer; if/when
  // we do (e.g. from the transcribe stage), wire it here.
  const peaks = useMemo(() => {
    if (words.length === 0) return [];
    const groups: Array<{ t: number; d: number; bars: number[] }> = [];
    for (let i = 0; i < words.length; i += 3) {
      const w = words[i];
      if (!w) continue;
      const span = Math.min(3, words.length - i);
      const last = words[i + span - 1];
      if (!last) continue;
      const d = last.t + last.d - w.t;
      const bars = Array.from({ length: 24 }, (_, j) => 30 + Math.abs(Math.sin(i * 7 + j * 1.4)) * 70);
      groups.push({ t: w.t, d, bars });
    }
    return groups;
  }, [words]);

  const dur = durationSec || 1;
  const pct = (t: number) => (t / dur) * 100;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= dur; s += 1) out.push(s);
    return out;
  }, [dur]);

  function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    seek(Math.max(0, Math.min(dur, x * dur)));
  }

  return (
    <>
      <div className={styles.ctlBar}>
        <span className={styles.ttl}>
          <span className={styles.dot} /> TIMELINE
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className={styles.ico} title="Collapse">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 10l4-4 4 4" />
          </svg>
        </button>
      </div>
      <div className={styles.ctlBody}>
        <div className={styles.ctlRuler} onClick={seekFromEvent}>
          {ticks.map((t, i) => (
            <span key={i}>
              <span className={styles.ctlTick} style={{ left: `${pct(t)}%` }} />
              {i % 1 === 0 && (
                <span className={styles.ctlTickLbl} style={{ left: `${pct(t)}%` }}>
                  {t.toFixed(1)}s
                </span>
              )}
            </span>
          ))}
        </div>
        <TimelineGroupsLane onSeek={seek} />
        <div className={styles.ctlLane} onClick={seekFromEvent}>
          {words.map((w) => {
            const isSel = selectedWord?.idx === w.idx;
            return (
              <div
                key={w.idx}
                className={`${styles.ctlWord}${isSel ? ' ' + styles.selected : ''}`}
                style={
                  {
                    left: `${pct(w.t)}%`,
                    width: `${pct(w.d)}%`,
                    background: w.color,
                    '--vc': w.color,
                  } as React.CSSProperties
                }
                onClick={(e) => {
                  e.stopPropagation();
                  selectWordForAgent(
                    isSel ? null : { idx: w.idx, text: w.text, t: w.t, d: w.d },
                  );
                }}
                title={`${w.text} · ${w.t.toFixed(2)}s`}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.text}</span>
              </div>
            );
          })}
        </div>
        <div className={`${styles.ctlLane} ${styles.audio}`} onClick={seekFromEvent}>
          {peaks.map((p, i) => (
            <div
              key={i}
              className={styles.ctlAudioBar}
              style={{ left: `${pct(p.t)}%`, width: `${pct(p.d)}%` }}
            >
              {p.bars.map((h, j) => (
                <span key={j} className={styles.wv} style={{ height: `${h}%` }} />
              ))}
            </div>
          ))}
        </div>
        <div className={styles.ctlPlayhead} style={{ left: `${pct(currentTime)}%` }}>
          <span className={styles.stamp}>{currentTime.toFixed(2)}s</span>
        </div>
      </div>
    </>
  );
}
