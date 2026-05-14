// Scene-groups lane on the caption timeline. Day 16 of the Director feature.
//
// Renders one GroupPill per scene group in the editor's directorScript,
// positioned by the wordRange → time mapping. Sits above the word-pill
// lane in CinematicTimeline so the eye reads "this is the BACK of the
// reel, the words within it are <these>".
//
// Read-only in v1; Day 17 adds drag-edge to update wordRange, double-click
// to change role, right-click context menu for merge/delete/duplicate.
//
// Renders nothing when there's no directorScript — keeps the timeline
// height stable for un-planned clips. The wrapping CinematicTimeline owns
// the rule-from-event seek handler; clicks that don't land on a pill fall
// through to ruler-style seeking.

import { useEditor } from '@/lib/editor/store';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';
import { GroupPill, useGroupPillData } from './GroupPill';

export function TimelineGroupsLane({
  onSeek,
}: {
  onSeek?: (timeSec: number) => void;
}) {
  const data = useGroupPillData();
  const durationSec = useEditor((s) => s.durationSec);
  const seek = useEditor((s) => s.seek);

  if (data.length === 0) return null;

  const handleSeek = onSeek ?? seek;

  return (
    <div className={`${styles.ctlLane} ${styles.groupsLane}`}>
      {data.map(({ group, leftPct, widthPct }) => {
        const tStart = (leftPct / 100) * durationSec;
        return (
          <GroupPill
            key={group.id}
            group={group}
            leftPct={leftPct}
            widthPct={widthPct}
            onClickSeek={() => handleSeek(tStart)}
          />
        );
      })}
    </div>
  );
}
