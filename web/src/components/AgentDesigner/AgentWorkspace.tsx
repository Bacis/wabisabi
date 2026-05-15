// 2-column workspace: chat panel (440px) on the left spans full height,
// preview column on the right stacks bar / stage / transport / timeline —
// mirrors the prototype's hierarchy where transport+timeline live under
// the preview, not under the chat.

import { useEditor } from '@/lib/editor/store';
import { AgentChatPane } from '@/components/AgentChatPane';
import type { UseAgentChatOpts } from '@/components/AgentChatPane/useAgentChat';
import { PreviewPanel } from '@/components/preview/PreviewPanel';
import { PhoneFrame } from './PhoneFrame';
import { PreviewBar } from './PreviewBar';
import { CinematicTransport } from './CinematicTransport';
import { CinematicTimeline } from './CinematicTimeline';
import { WordStyler } from './WordStyler';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

export function AgentWorkspace({
  chatOpts,
  initialPrompt,
}: {
  chatOpts?: UseAgentChatOpts;
  initialPrompt?: string;
} = {}) {
  const selectedWord = useEditor((s) => s.selectedWord);
  const setChatPrefill = useEditor((s) => s.setChatPrefill);

  return (
    <div className={styles.workspace}>
      <div className={styles.zoneChat}>
        <AgentChatPane chatOpts={chatOpts} initialPrompt={initialPrompt} />
      </div>
      <div className={styles.zonePreviewCol}>
        <div className={styles.zonePreview}>
          <PreviewBar />
          <div className={styles.previewStage}>
            <WordStyler onAskAgent={(prefill) => setChatPrefill(prefill)} />
            <PhoneFrame pointOn={!!selectedWord}>
              {/* SelectionLayer overlays the rendered caption with a
                  draggable/resizable/rotatable hit-zone. Before the user
                  has written styleSpec.captionTransform the gizmo's
                  default is measured from the live caption container's
                  bbox (see SelectionLayer), so it lines up with the real
                  text. Clicking commits a captionTransform that the
                  renderer then honors going forward. */}
              <PreviewPanel />
            </PhoneFrame>
          </div>
        </div>
        <CinematicTransport />
        <div className={styles.zoneTimeline}>
          <CinematicTimeline />
        </div>
      </div>
    </div>
  );
}
