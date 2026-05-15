// Single scene-group pill on the timeline. Day 16-17 of the Director feature.
//
// Day 16: read-only render.
// Day 17: drag-edge resize, click-to-select, double-click-to-change-role.
//
// Drag math: the pill's parent lane spans the full timeline width. Mouse
// clientX → fractional position within the lane → fractional word index
// (× tokenCount). We snap to integer word boundaries on every frame so
// the pill never sits between words; that keeps the wordRange aligned
// with the renderer's per-word lookup.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@/lib/editor/store';
import {
  FAMILY_COLORS,
  GROUP_ROLES_LIST,
  ROLE_BADGE,
  roleFamily,
  type GroupRole,
  type SceneGroup,
} from '@/lib/director';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

export type GroupPillProps = {
  group: SceneGroup;
  leftPct: number;
  widthPct: number;
  onClickSeek?: () => void;
  selected?: boolean;
  /** Truncated transcript words for this group's wordRange — shown inside
   *  the pill as a tertiary preview line so the user can recognize the
   *  scene without having to read the chat history. Empty string is fine. */
  transcriptPreview?: string;
};

type DragState =
  | { kind: 'idle' }
  | { kind: 'left' | 'right'; laneRect: DOMRect; tokenCount: number };

export function GroupPill({ group, leftPct, widthPct, onClickSeek, selected, transcriptPreview }: GroupPillProps) {
  const family = roleFamily(group.role);
  const color = FAMILY_COLORS[family];
  const label = group.label ?? '';

  const updateDirectorGroup = useEditor((s) => s.updateDirectorGroup);
  const selectGroupForAgent = useEditor((s) => s.selectGroupForAgent);
  const transcriptText = useEditor((s) => s.transcriptText);
  const tokenCount = useMemo(
    () => transcriptText.split(/\s+/).filter(Boolean).length,
    [transcriptText],
  );

  const dragRef = useRef<DragState>({ kind: 'idle' });
  const [, forceUpdate] = useState(0);
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  // Locate the parent lane on mousedown so the mousemove handler can map
  // clientX → fractional word index without re-querying the DOM each move.
  const beginDrag = (e: React.MouseEvent<HTMLSpanElement>, edge: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    const lane = (e.currentTarget.closest(`.${styles.ctlLane}`) ?? e.currentTarget.parentElement?.parentElement) as HTMLElement | null;
    if (!lane || tokenCount === 0) return;
    dragRef.current = {
      kind: edge,
      laneRect: lane.getBoundingClientRect(),
      tokenCount,
    };
    forceUpdate((n) => n + 1);
  };

  useEffect(() => {
    if (dragRef.current.kind === 'idle') return;

    function onMove(ev: MouseEvent) {
      const st = dragRef.current;
      if (st.kind === 'idle') return;
      const frac = (ev.clientX - st.laneRect.left) / st.laneRect.width;
      const clamped = Math.min(1, Math.max(0, frac));
      // Round down to a word boundary so the pill snaps as the cursor
      // crosses an integer threshold.
      const wIdx = Math.min(st.tokenCount - 1, Math.max(0, Math.round(clamped * st.tokenCount)));
      if (st.kind === 'left') {
        // Left edge must stay <= right edge - 0.
        const newStart = Math.min(group.wordRange[1], wIdx);
        if (newStart !== group.wordRange[0]) {
          updateDirectorGroup(group.id, { wordRange: [newStart, group.wordRange[1]] });
        }
      } else {
        const newEnd = Math.max(group.wordRange[0], wIdx);
        if (newEnd !== group.wordRange[1]) {
          updateDirectorGroup(group.id, { wordRange: [group.wordRange[0], newEnd] });
        }
      }
    }

    function onUp() {
      dragRef.current = { kind: 'idle' };
      forceUpdate((n) => n + 1);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // dragRef.current is intentionally the only trigger; re-run on every
    // begin/end of a drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragRef.current.kind, group.id, group.wordRange, updateDirectorGroup]);

  function pickRole(newRole: GroupRole) {
    if (newRole !== group.role) {
      updateDirectorGroup(group.id, { role: newRole });
    }
    setShowRoleMenu(false);
  }

  return (
    <div
      className={`${styles.groupPill}${selected ? ' ' + styles.selected : ''}`}
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        borderColor: color.border,
        background: color.fill,
        color: color.text,
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectGroupForAgent(group.id);
        onClickSeek?.();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setShowRoleMenu((v) => !v);
      }}
      title={
        group.rationale
          ? `${ROLE_BADGE[group.role]} · ${label} — ${group.rationale}`
          : `${ROLE_BADGE[group.role]} · ${label || group.role}`
      }
    >
      <span
        className={styles.gpEdge}
        style={{ left: 0 }}
        onMouseDown={(e) => beginDrag(e, 'left')}
        title="Drag to resize start"
      />
      <div className={styles.gpCols}>
        <div className={styles.gpHeadRow}>
          <span className={styles.gpBadge}>{ROLE_BADGE[group.role]}</span>
          {label && <span className={styles.gpLabel}>{label}</span>}
        </div>
        {transcriptPreview && (
          <span className={styles.gpTranscript}>{transcriptPreview}</span>
        )}
      </div>
      <span
        className={styles.gpEdge}
        style={{ right: 0 }}
        onMouseDown={(e) => beginDrag(e, 'right')}
        title="Drag to resize end"
      />
      {showRoleMenu && (
        <div className={styles.gpRoleMenu} onClick={(e) => e.stopPropagation()}>
          {GROUP_ROLES_LIST.map((r) => (
            <button
              key={r}
              type="button"
              className={`${styles.gpRoleItem}${r === group.role ? ' ' + styles.gpRoleActive : ''}`}
              onClick={() => pickRole(r)}
            >
              <span className={styles.gpRoleBadge}>{ROLE_BADGE[r]}</span>
              <span>{r}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper used by TimelineGroupsLane to render every group from the editor
// store. Computes wordTimings from the same transcriptText+durationSec
// model the renderer uses, so each pill spans exactly its group's range.
// Also slices the group's transcript words so the pill can show a
// scene-recognizable preview ("opening frustration statement…") instead
// of an empty colored block.
export function useGroupPillData(): Array<{
  group: SceneGroup;
  leftPct: number;
  widthPct: number;
  transcriptPreview: string;
}> {
  const transcriptText = useEditor((s) => s.transcriptText);
  const durationSec = useEditor((s) => s.durationSec);
  const directorScript = useEditor((s) => s.directorScript);

  if (!directorScript || directorScript.groups.length === 0) return [];
  const tokens = transcriptText.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (tokens.length === 0 || durationSec <= 0) return [];
  const per = durationSec / tokens.length;

  return directorScript.groups.map((g) => {
    const startIdx = Math.min(tokens.length - 1, Math.max(0, g.wordRange[0]));
    const endIdx = Math.min(tokens.length - 1, Math.max(0, g.wordRange[1]));
    const tStart = startIdx * per;
    const tEnd = (endIdx + 1) * per;
    const leftPct = (tStart / durationSec) * 100;
    const widthPct = ((tEnd - tStart) / durationSec) * 100;
    // Slice the words in this group's range and join them as a single
    // preview line. The pill itself applies CSS ellipsis at render time,
    // so we can pass the full string — wider pills show more of it.
    const groupWords = tokens.slice(startIdx, endIdx + 1).join(' ');
    return { group: g, leftPct, widthPct, transcriptPreview: groupWords };
  });
}
