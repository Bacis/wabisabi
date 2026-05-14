// Director script checklist — renders each scene group as a row with role
// badge, word range, and rationale. Day 10 of the Director feature.
//
// Read-only in v1; Day 17 wires the drop / change-role / drag-edge edit
// affordances by lifting interactions through props to the editor store.
// The component is consumed by ActionCard.tsx — when an agent turn includes
// an apply_director_script tool call, this checklist renders below the
// (likely empty) styleSpec diff grid.

import { Icon } from './Icon';
import styles from './AgentChatPane.module.css';
import {
  FAMILY_COLORS,
  ROLE_BADGE,
  roleFamily,
  type DirectorScript,
} from '@/lib/director';

export function DirectorChecklist({
  script,
  applied,
}: {
  script: DirectorScript;
  applied: boolean;
}) {
  return (
    <div
      className={`${styles.actionCard} ${styles.dsCard}${applied ? ' ' + styles.applied : ''}`}
    >
      <div className={styles.head}>
        <span className={styles.ico}>
          <Icon name="diff" size={14} />
        </span>
        <span className={styles.lbl}>
          Director plan · {script.groups.length} group{script.groups.length === 1 ? '' : 's'}
        </span>
        {script.beats.length > 0 && (
          <span className={styles.pill}>{script.beats.length} BEATS</span>
        )}
        {applied && <span className={styles.pill}>APPLIED</span>}
      </div>
      <div className={styles.dsList}>
        {script.groups.map((g, idx) => {
          const family = roleFamily(g.role);
          const color = FAMILY_COLORS[family];
          return (
            <div
              key={g.id}
              className={styles.dsGroup}
              style={{ borderColor: color.border, background: color.fill }}
            >
              <div className={styles.dsHeadRow}>
                <span className={styles.dsIdx}>{idx + 1}</span>
                <span
                  className={styles.dsBadge}
                  style={{ color: color.text, borderColor: color.border }}
                >
                  {ROLE_BADGE[g.role]}
                </span>
                {g.label && <span className={styles.dsLabel}>{g.label}</span>}
                <span className={styles.dsRange}>
                  w{g.wordRange[0]}–{g.wordRange[1]}
                </span>
              </div>
              {g.rationale && <div className={styles.dsRationale}>{g.rationale}</div>}
              {(g.audioCue || g.audioPattern || g.layoutStrategy || g.placement) && (
                <div className={styles.dsMeta}>
                  {g.layoutStrategy && (
                    <span className={styles.dsMetaPill}>layout: {g.layoutStrategy}</span>
                  )}
                  {g.placement?.anchor && (
                    <span className={styles.dsMetaPill}>anchor: {g.placement.anchor}</span>
                  )}
                  {g.audioCue?.gesture && (
                    <span className={styles.dsMetaPill}>audio: {g.audioCue.gesture}</span>
                  )}
                  {g.audioPattern?.type && (
                    <span className={styles.dsMetaPill}>
                      pattern: {g.audioPattern.type}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
