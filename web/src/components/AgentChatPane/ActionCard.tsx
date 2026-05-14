// Visual diff card for an agent turn. Walks the `patch.styleSpec` deltas
// and renders one line per changed leaf-field, mirroring the prototype's
// diff-grid look. Color values get a swatch chip; other values render
// as monospace text.

import { Icon } from './Icon';
import styles from './AgentChatPane.module.css';
import type { UIAgentMessage } from './useAgentChat';
import { DirectorChecklist } from './DirectorChecklist';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function flatten(obj: Record<string, unknown>, prefix = ''): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) {
      out.push(...flatten(v, path));
    } else {
      out.push([path, v]);
    }
  }
  return out;
}

function isColor(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-f]{3,8})$/i.test(v.trim());
}

function pickAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every(isColor)) return v.join(' · ');
    return JSON.stringify(v).slice(0, 40);
  }
  return JSON.stringify(v).slice(0, 40);
}

export function ActionCard({
  msg,
  onTweak,
  onReject,
}: {
  msg: UIAgentMessage;
  onTweak?: (msg: UIAgentMessage) => void;
  onReject?: (msg: UIAgentMessage) => void;
}) {
  // Mine the patch from the toolTrace — first non-acknowledge call.
  const patchCall = msg.toolTrace.find(
    (c) => c.name === 'apply_style_patch' || c.name === 'add_chunk_override' || c.name === 'switch_template',
  );
  const directorScript = msg.appliedDirectorScript;
  // No-change only when there's no styleSpec patch AND no Director script.
  const isNoChange =
    !directorScript && (!patchCall || msg.toolTrace[0]?.name === 'acknowledge_no_change');

  let target = 'styleSpec';
  let targetPill: { label: string; color: string } | null = null;
  let diffPairs: Array<{ key: string; v0: unknown; v1: unknown }> = [];

  if (patchCall?.name === 'apply_style_patch') {
    const newSpec = (patchCall.input.styleSpec as Record<string, unknown>) ?? {};
    // Describe the target by its top-level groups (color, font, animation...)
    // so the head says exactly which surfaces changed — e.g. "color · font".
    const topGroups = Object.keys(newSpec).filter((k) => isPlainObject(newSpec[k]));
    target = topGroups.length > 0 ? topGroups.join(' · ') : 'styleSpec';
    diffPairs = flatten(newSpec).map(([key, v1]) => ({
      key,
      v0: pickAtPath(msg.priorSpec, key),
      v1,
    }));
    // Pull the leading new color (fill or emphasis) for the pill tint.
    const flat = diffPairs.find((d) => isColor(d.v1));
    if (flat) targetPill = { label: topGroups[0] ?? 'style', color: String(flat.v1) };
  } else if (patchCall?.name === 'add_chunk_override') {
    const range = patchCall.input.range as [number, number];
    const overrides = (patchCall.input.overrides as Record<string, unknown>) ?? {};
    target = `chunk ${range[0]}–${range[1]}`;
    diffPairs = flatten(overrides).map(([key, v1]) => ({ key, v0: '—', v1 }));
    const flat = diffPairs.find((d) => isColor(d.v1));
    if (flat) targetPill = { label: `chunk ${range[0]}`, color: String(flat.v1) };
  } else if (patchCall?.name === 'switch_template') {
    target = 'template';
    diffPairs = [
      {
        key: 'templateId',
        v0: msg.priorTemplateId,
        v1: patchCall.input.templateId,
      },
    ];
  }

  // Verb-accent: tint the first word of the agent's reply in cyan
  // ("Pumped.", "Eased.", "Cranked.") to match the prototype's voice
  // styling. Falls back gracefully when the reply lacks a leading verb.
  const replyMatch = msg.assistantMessage.match(/^(\S+)\s*([\s\S]*)$/);
  const verb = replyMatch?.[1] ?? msg.assistantMessage;
  const tail = replyMatch?.[2] ?? '';

  return (
    <div className={styles.msgAgent}>
      <div className={styles.av} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.applied}>
          <span className={styles.verb}>{verb}</span>
          {tail ? ` ${tail}` : ''}
        </div>
        {directorScript && (
          <DirectorChecklist script={directorScript} applied={msg.applied} />
        )}
        {!isNoChange && diffPairs.length > 0 && (
          <div className={`${styles.actionCard}${msg.applied ? ' ' + styles.applied : ''}`}>
            <div className={styles.head}>
              <span className={styles.ico}>
                <Icon name="diff" size={14} />
              </span>
              <span className={styles.lbl}>Change · {target}</span>
              {targetPill && (
                <span
                  className={styles.pill}
                  style={{
                    color: targetPill.color,
                    background: `${targetPill.color}16`,
                    borderColor: `${targetPill.color}55`,
                  }}
                >
                  {targetPill.label}
                </span>
              )}
              {msg.applied && <span className={styles.pill}>APPLIED</span>}
            </div>
            <div className={styles.diffGrid}>
              {diffPairs.slice(0, 10).map((d, i) => (
                <div key={i} className={styles.diffLine}>
                  <span className={styles.k}>{d.key}</span>
                  <span className={styles.v0}>
                    {isColor(d.v0) && <span className={styles.swatch} style={{ background: d.v0 }} />}
                    {formatValue(d.v0)}
                  </span>
                  <span className={styles.arr}>→</span>
                  <span className={styles.v1}>
                    {isColor(d.v1) && <span className={styles.swatch} style={{ background: d.v1 }} />}
                    {formatValue(d.v1)}
                  </span>
                </div>
              ))}
              {diffPairs.length > 10 && (
                <div className={styles.diffLine}>
                  <span className={styles.k}>+ {diffPairs.length - 10} more</span>
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
            <div className={styles.acts}>
              <button type="button" className={styles.accept} title="Accept (already applied)">
                <Icon name="check" size={11} /> {msg.applied ? 'APPLIED' : 'ACCEPT'}
              </button>
              <button type="button" onClick={() => onTweak?.(msg)} title="Add a follow-up tweak">
                <Icon name="edit" size={11} /> TWEAK
              </button>
              <button
                type="button"
                className={styles.reject}
                onClick={() => onReject?.(msg)}
                title="Roll back this turn"
              >
                <Icon name="x" size={11} /> REJECT
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
