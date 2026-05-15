// /designer/:id — resume a saved agent conversation. Fetches the
// designer_sessions row, restores the editor source + styleSpec + chat
// transcript, then renders the same AgentDesigner shell used by /designer/new.
// Every subsequent agent reply PATCHes the row so the timestamp + state stay
// fresh in the history list.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { AgentDesigner } from '@/components/AgentDesigner';
import {
  Button,
  MonoLabel,
  atelierStyles as a,
} from '@/components/atelier';
import {
  getDesignerSession,
  patchDesignerSession,
  type DesignerSession,
} from '@/lib/api';
import type { EditorSource } from '@/lib/useEditableSource';
import type { UIMessage } from '@/components/AgentChatPane/useAgentChat';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; session: DesignerSession };

export function DesignerSessionPage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!id) {
      setLoad({ status: 'error', error: 'missing session id' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading' });
    getDesignerSession(id)
      .then((session) => {
        if (!cancelled) setLoad({ status: 'ready', session });
      })
      .catch((err) => {
        if (!cancelled) setLoad({ status: 'error', error: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Stable EditorSource — only depends on the session's source ref. Avoids
  // useEditableSource flapping on every session.messages tick.
  const editorSource = useMemo<EditorSource | null>(() => {
    if (load.status !== 'ready') return null;
    const { sourceKind, sourceId } = load.session;
    return sourceKind === 'stock'
      ? { kind: 'stock', clipId: sourceId }
      : { kind: 'job', jobId: sourceId };
  }, [load]);

  if (load.status === 'loading') {
    return (
      <div className={a.page} style={{ paddingTop: 60 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Loader2 size={16} className="animate-spin" />
          <MonoLabel tone="dim">Loading session…</MonoLabel>
        </div>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className={a.page} style={{ paddingTop: 60 }}>
        <MonoLabel tone="danger" dot>Couldn't load session</MonoLabel>
        <p style={{ marginTop: 8 }}>{load.error}</p>
        <div style={{ marginTop: 16 }}>
          <Button
            as="a"
            href="/designer/history"
            variant="ghost"
            leadingIcon={<ArrowLeft size={13} />}
          >
            Back to history
          </Button>
        </div>
      </div>
    );
  }

  const session = load.session;
  const initialMessages = session.messages as UIMessage[];

  return (
    <AgentDesigner
      source={editorSource!}
      initialStyleSpecOverride={session.styleSpec}
      initialDirectorScript={session.directorScript}
      chatOpts={{
        sessionId: session.id,
        initialMessages,
        onTurnComplete: ({ messages, styleSpec, directorScript }) => {
          // Fire-and-forget — the visible state is already correct; the
          // PATCH just makes it durable. Failures log but don't surface
          // to the user mid-conversation.
          patchDesignerSession(session.id, {
            messages,
            styleSpec,
            directorScript,
          }).catch((err) => console.warn('designer session patch failed', err));
        },
      }}
    />
  );
}
