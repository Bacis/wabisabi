// Skeleton rendered while useEditableSource is still fetching transcript +
// video URL. Mirrors the AgentWorkspace grid 1:1 so the swap to the real
// editor doesn't shift layout — only the contents of each zone change.
//
// The chat zone is non-interactive but shows the user's initial prompt as a
// "sent" bubble plus a thinking indicator, so the page reads as "your message
// is being processed" rather than "the app is loading."

import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

const SHIMMER = `
@keyframes wabisabiShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.wbsi-skel {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.10) 50%,
    rgba(255, 255, 255, 0.04) 100%
  );
  background-size: 200% 100%;
  animation: wabisabiShimmer 1.6s linear infinite;
  border-radius: 8px;
}
.wbsi-dotPulse {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.wbsi-dotPulse > span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ag-ink-3, #888);
  animation: wabisabiDot 1.1s ease-in-out infinite;
}
.wbsi-dotPulse > span:nth-child(2) { animation-delay: 0.18s; }
.wbsi-dotPulse > span:nth-child(3) { animation-delay: 0.36s; }
@keyframes wabisabiDot {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}
`;

export function WorkspaceSkeleton({
  initialPrompt,
  // Aspect of the preview placeholder. Defaults to 9:16 portrait but
  // accepts any "w/h" CSS aspect-ratio string so the skeleton matches
  // the eventual canvas (horizontal sources slot in a 16:9 shimmer).
  canvasAspect = '9 / 16',
}: {
  initialPrompt?: string;
  canvasAspect?: string;
}) {
  return (
    <>
      <style>{SHIMMER}</style>
      <div className={styles.workspace}>
        {/* Chat zone — static. Renders the user's prompt as a sent
            bubble and shows wabisabi "thinking" so the page reads as
            "your message is queued" instead of "nothing's happening." */}
        <div className={styles.zoneChat}>
          <div
            style={{
              padding: '18px 20px 12px',
              borderBottom: '1px solid var(--ag-line, #2a2a2a)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'var(--ag-font-mono)',
              fontSize: 11,
              color: 'var(--ag-ink-3, #888)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#fbbf24',
                boxShadow: '0 0 8px #fbbf24',
              }}
            />
            wabisabi · preparing source
          </div>

          <div style={{ flex: 1, overflow: 'hidden', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {initialPrompt ? (
              <div
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  background: 'var(--ag-surface, #1a1a1a)',
                  border: '1px solid var(--ag-line, #2a2a2a)',
                  padding: '10px 14px',
                  borderRadius: 12,
                  borderTopRightRadius: 4,
                  color: 'var(--ag-ink-1, #ddd)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {initialPrompt}
              </div>
            ) : null}

            <div
              style={{
                alignSelf: 'flex-start',
                maxWidth: '85%',
                background: 'var(--ag-panel-2, #141414)',
                border: '1px solid var(--ag-line, #2a2a2a)',
                padding: '10px 14px',
                borderRadius: 12,
                borderTopLeftRadius: 4,
                color: 'var(--ag-ink-3, #999)',
                fontSize: 12.5,
                display: 'flex',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <span className="wbsi-dotPulse" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              <span>downloading + transcribing your clip…</span>
            </div>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--ag-line, #2a2a2a)',
              padding: '14px 16px',
              opacity: 0.4,
              fontFamily: 'var(--ag-font-mono)',
              fontSize: 11.5,
              color: 'var(--ag-ink-3, #888)',
            }}
          >
            ask the agent…
          </div>
        </div>

        {/* Preview column — matches AgentWorkspace's stacking. */}
        <div className={styles.zonePreviewCol}>
          <div className={styles.zonePreview}>
            <div className={styles.previewBar}>
              <div className={styles.previewBarLeft}>
                <span className={styles.clipName} style={{ opacity: 0.5 }}>
                  loading…
                </span>
                <span className={styles.tag} style={{ opacity: 0.4 }}>
                  9 : 16
                </span>
              </div>
            </div>
            <div className={styles.previewStage}>
              <div
                className="wbsi-skel"
                style={{
                  // Match the eventual canvas aspect (passed in by the
                  // caller from source dims) so the shimmer doesn't jump
                  // when the real preview swaps in.
                  aspectRatio: canvasAspect,
                  height: '100%',
                  maxWidth: '100%',
                  borderRadius: 32,
                  border: '1px solid var(--ag-line, #2a2a2a)',
                }}
              />
            </div>
          </div>
          <div className={styles.zoneTimeline}>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                className="wbsi-skel"
                style={{ height: 18, width: '40%' }}
              />
              <div
                className="wbsi-skel"
                style={{ height: 36, width: '100%' }}
              />
              <div
                className="wbsi-skel"
                style={{ height: 24, width: '88%' }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
