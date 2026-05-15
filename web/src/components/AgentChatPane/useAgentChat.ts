// Chat state for /designer/:id. Owns the UI thread (user bubbles + agent
// action cards) plus the threadId. The threadId doubles as the
// designer_sessions row id: when the host page provides a sessionId, the
// hook uses it as the threadId so the server-side LangGraph thread and the
// persisted DB row share a single key.
//
// Persistence is a host-page concern (see /designer/new and /designer/:id):
// the hook calls onFirstUserTurn() right before sending the user's first
// chat turn (so the page can mint a DB row + navigate) and onTurnComplete()
// after each successful agent reply (so the page can PATCH the row).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@/lib/editor/store';
import { postAgentChat, type AgentChatResponse, type AgentToolCall } from '@/lib/api';
import {
  directorScriptToChunkOverrides,
  directorScriptToStyleSpecPatch,
  type DirectorScript,
} from '@/lib/director';

export type UIUserMessage = {
  kind: 'user';
  id: string;
  text: string;
  // The raw slash (if the user typed one) — preserved for affordance.
  slashSource?: string;
  // Selected word that was attached when this message was sent.
  attachedWord?: { idx: number; text: string; t: number; d: number };
};

export type UIAgentMessage = {
  kind: 'agent';
  id: string;
  assistantMessage: string;
  toolTrace: AgentToolCall[];
  // Snapshot of the styleSpec BEFORE this turn applied — for the diff card.
  priorSpec: Record<string, unknown>;
  priorTemplateId: string;
  // Snapshot of the directorScript BEFORE this turn (null if no plan existed).
  // Used by revertAt() to restore the prior plan if the user rejects.
  priorDirectorScript: DirectorScript | null;
  // Whether the resulting patch was actually applied (vs no-change).
  applied: boolean;
  // Whole-video plan emitted on this turn (if the agent called
  // apply_director_script). The ActionCard renders this as a checklist;
  // null means this turn was a non-Director tweak.
  appliedDirectorScript: DirectorScript | null;
};

export type UIMessage = UIUserMessage | UIAgentMessage;

function uuid() {
  // crypto.randomUUID is available in all modern browsers + Node 19+.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type UseAgentChatOpts = {
  /**
   * Stable session id for this conversation. When provided, doubles as the
   * threadId so the server-side LangGraph thread aligns with the persisted
   * designer_sessions row. When null/absent, the hook mints a client-side
   * uuid (the /designer/new "draft" flow until the first message lands).
   */
  sessionId?: string | null;
  /**
   * Messages to seed the UI thread with (replayed when resuming a saved
   * session). Applied once on the first render that the prop is non-null;
   * subsequent message edits live in hook state.
   */
  initialMessages?: UIMessage[];
  /**
   * Called right before the user's FIRST chat turn is dispatched to the
   * agent. The page should mint the designer_sessions row keyed by
   * `threadId` and navigate to /designer/{threadId}. If the promise
   * rejects, the chat still proceeds — the conversation just won't be
   * persisted until the next successful PATCH.
   */
  onFirstUserTurn?: (payload: {
    threadId: string;
    firstMessage: string;
  }) => Promise<void> | void;
  /**
   * Called after every successful agent reply with the full updated
   * messages array, the latest styleSpec, and the latest directorScript
   * (the whole-video scene plan; null if the agent has never fired
   * apply_director_script for this session OR a revert just dropped it).
   * The page PATCHes the designer_sessions row with these so reopens
   * restore the entire editor state.
   */
  onTurnComplete?: (payload: {
    messages: UIMessage[];
    styleSpec: Record<string, unknown>;
    directorScript: unknown | null;
  }) => void;
};

export function useAgentChat(opts: UseAgentChatOpts = {}) {
  const { sessionId, initialMessages, onFirstUserTurn, onTurnComplete } = opts;

  // Stable per chat session. When the host page provides a sessionId, we
  // pin to it (resuming a saved session). Otherwise we mint a client-side
  // uuid and reuse it once the page mints the matching DB row.
  const threadIdRef = useRef<string | null>(null);
  if (threadIdRef.current === null) {
    threadIdRef.current = sessionId ?? uuid();
  }
  // Track which sessionId we've pinned to so a late-arriving prop (page
  // hydrating from the server) replaces the placeholder uuid cleanly.
  const pinnedSessionIdRef = useRef<string | null>(sessionId ?? null);
  if (sessionId && pinnedSessionIdRef.current !== sessionId) {
    threadIdRef.current = sessionId;
    pinnedSessionIdRef.current = sessionId;
  }

  const [messages, setMessages] = useState<UIMessage[]>(initialMessages ?? []);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from prop once initialMessages arrives (the parent fetches the
  // session in an effect, so the first render is empty). Keyed by sessionId
  // so navigating between sessions reseeds correctly.
  const hydratedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !initialMessages) return;
    if (hydratedKeyRef.current === sessionId) return;
    hydratedKeyRef.current = sessionId;
    setMessages(initialMessages);
  }, [sessionId, initialMessages]);

  // Capture callbacks in refs so send() can reference the latest version
  // without retriggering its useCallback identity (which would re-render
  // AgentChatPane on every parent re-render).
  const firstTurnRef = useRef(onFirstUserTurn);
  firstTurnRef.current = onFirstUserTurn;
  const turnCompleteRef = useRef(onTurnComplete);
  turnCompleteRef.current = onTurnComplete;
  // A "session" here means: has the page persisted a row for this thread
  // yet? In draft mode (no sessionId prop, no first-turn yet) we still need
  // to fire onFirstUserTurn exactly once.
  const firstTurnFiredRef = useRef<boolean>(!!sessionId);
  useEffect(() => {
    if (sessionId) firstTurnFiredRef.current = true;
  }, [sessionId]);

  // Pull only the store actions we need; reads happen inside send() via
  // useEditor.getState() so we always see the latest spec.
  const applyThemePatch = useEditor((s) => s.applyThemePatch);
  const updateStyleSpecPath = useEditor((s) => s.updateStyleSpecPath);
  const setTemplateId = useEditor((s) => s.setTemplateId);
  const setDirectorScript = useEditor((s) => s.setDirectorScript);
  const clearSelectedWord = useEditor((s) => s.clearSelectedWord);

  const send = useCallback(
    async (input: {
      text: string;
      // The natural-language prompt the agent sees. May differ from `text`
      // when the user typed a slash command.
      expanded: string;
      attachedWord?: { idx: number; text: string; t: number; d: number };
      slashSource?: string;
    }) => {
      const trimmed = input.expanded.trim();
      if (!trimmed || sending) return;

      const userId = uuid();
      const userMessage: UIUserMessage = {
        kind: 'user',
        id: userId,
        text: input.text,
        slashSource: input.slashSource,
        attachedWord: input.attachedWord,
      };
      setMessages((prev) => [...prev, userMessage]);
      setError(null);
      setSending(true);

      // First-turn hook: page mints the DB row + redirects to /designer/:id
      // before the chat request flies. Don't block the chat if persistence
      // fails — degraded mode keeps the local convo going.
      if (!firstTurnFiredRef.current) {
        firstTurnFiredRef.current = true;
        try {
          await firstTurnRef.current?.({
            threadId: threadIdRef.current!,
            firstMessage: input.text,
          });
        } catch (err) {
          console.warn('designer session create failed; continuing in draft mode', err);
        }
      }

      const snapshot = useEditor.getState();
      const priorSpec = snapshot.styleSpec;
      const priorTemplateId = snapshot.templateId;
      const priorDirectorScript = snapshot.directorScript;

      // Build the timed PlannerWord[] from the captionTrack so the
      // server-side apply_director_script tool can delegate to the
      // Director planner without having to ask the user for the transcript.
      const captionTrack = snapshot.tracks.find((t) => t.type === 'captions');
      const transcript =
        captionTrack && captionTrack.type === 'captions'
          ? captionTrack.items.map((w, idx) => ({ idx, t: w.start, w: w.text }))
          : undefined;

      try {
        const res: AgentChatResponse = await postAgentChat({
          threadId: threadIdRef.current!,
          message: trimmed,
          currentSpec: priorSpec,
          templateId: priorTemplateId,
          selectedWord: input.attachedWord,
          transcriptSummary: {
            totalWords: snapshot.transcriptText
              .split(/\s+/)
              .filter(Boolean).length,
            durationSec: snapshot.durationSec,
          },
          transcript,
        });

        // Apply the patch (if any) to the live preview.
        let applied = false;
        if (res.patch) {
          if (res.patch.templateId && res.patch.templateId !== priorTemplateId) {
            setTemplateId(res.patch.templateId);
            applied = true;
          }
          if (res.patch.scope === 'global' && res.patch.styleSpec) {
            applyThemePatch(res.patch.styleSpec);
            applied = true;
          }
          if (res.patch.scope === 'chunk' && res.patch.chunkOverride) {
            const current = (useEditor.getState().styleSpec.chunkOverrides as
              | Array<{ range: [number, number]; overrides: Record<string, unknown> }>
              | undefined) ?? [];
            updateStyleSpecPath('chunkOverrides', [...current, res.patch.chunkOverride]);
            applied = true;
          }
          // Whole-video Director plan — applied alongside any styleSpec
          // patch. The timeline groups lane (Day 16+) and the renderer's
          // resolveWordContext both read from this single store slot.
          //
          // We ALSO translate the script's project invariants (brand fill,
          // font, casing) into a styleSpec patch and apply it, so the
          // existing reel-clone renderer picks up the planner's brand
          // decisions without waiting on a deeper resolveWordContext
          // integration. Per-group overrides still wait on the
          // word→chunk-index mapping work.
          if (res.patch.directorScript) {
            setDirectorScript(res.patch.directorScript);
            // 1) project invariants → top-level styleSpec patch
            applyThemePatch(directorScriptToStyleSpecPatch(res.patch.directorScript));
            // 2) per-group overrides → chunkOverrides[]. Read maxPerLine
            //    from the freshly-patched spec (a project-level font change
            //    may have shifted maxWordsPerLine via apply, though today
            //    that field isn't part of the planner output). Default 4
            //    mirrors the renderer's fallback chunker.
            const latest = useEditor.getState().styleSpec;
            const maxPerLine = (latest.layout?.maxWordsPerLine as number | undefined) ?? 4;
            const chunkOverrides = directorScriptToChunkOverrides(
              res.patch.directorScript,
              maxPerLine,
            );
            updateStyleSpecPath('chunkOverrides', chunkOverrides);
            applied = true;
          }
        }

        const agentMessage: UIAgentMessage = {
          kind: 'agent',
          id: uuid(),
          assistantMessage: res.assistantMessage,
          toolTrace: res.toolTrace,
          priorSpec,
          priorTemplateId,
          priorDirectorScript,
          applied,
          appliedDirectorScript: res.patch?.directorScript ?? null,
        };
        setMessages((prev) => {
          const next = [...prev, agentMessage];
          // Fire the persistence callback with the full updated transcript
          // + the freshly-applied styleSpec + directorScript. Microtask
          // defer keeps the PATCH out of React's commit phase.
          const snap = useEditor.getState();
          queueMicrotask(() => {
            turnCompleteRef.current?.({
              messages: next,
              styleSpec: snap.styleSpec,
              directorScript: snap.directorScript,
            });
          });
          return next;
        });
        // Clear the selection chip — user can re-click another word to scope
        // the next turn. Matches the prototype's behavior where the chip
        // disappears after the message lands.
        if (input.attachedWord) clearSelectedWord();
      } catch (err) {
        setError((err as Error).message || 'agent request failed');
      } finally {
        setSending(false);
      }
    },
    [sending, applyThemePatch, updateStyleSpecPath, setTemplateId, setDirectorScript, clearSelectedWord],
  );

  // Client-side /revert — pop the last completed turn and roll the spec back.
  // Two-step so we never call useEditor.setState (a Zustand notification)
  // inside the React reducer for setMessages — that fires PreviewPanel's
  // re-render mid-render of AgentChatPane and trips React's
  // "Cannot update a component while rendering" warning.
  const revertLast = useCallback(() => {
    setMessages((prev) => {
      let snapshot: UIAgentMessage | null = null;
      let cutAt = prev.length;
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m && m.kind === 'agent') {
          snapshot = m;
          cutAt = Math.max(0, i - 1);
          break;
        }
      }
      if (!snapshot) return prev;
      const spec = snapshot.priorSpec;
      const tpl = snapshot.priorTemplateId;
      const ds = snapshot.priorDirectorScript;
      queueMicrotask(() => {
        useEditor.setState({ styleSpec: spec, templateId: tpl, directorScript: ds });
      });
      return prev.slice(0, cutAt);
    });
  }, []);

  // Roll back to the state BEFORE a specific agent turn — used by the
  // checkpoint markers and the REJECT button on action cards. Drops every
  // turn from that one onward; the corresponding user message above it is
  // also pruned so the thread stays coherent.
  const revertAt = useCallback((messageId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx < 0) return prev;
      const target = prev[idx];
      if (!target || target.kind !== 'agent') return prev;
      const spec = target.priorSpec;
      const tpl = target.priorTemplateId;
      const ds = target.priorDirectorScript;
      queueMicrotask(() => {
        useEditor.setState({ styleSpec: spec, templateId: tpl, directorScript: ds });
      });
      // Drop this agent message + the user message that triggered it (idx-1).
      return prev.slice(0, Math.max(0, idx - 1));
    });
  }, []);

  return useMemo(
    () => ({
      threadId: threadIdRef.current!,
      messages,
      sending,
      error,
      send,
      revertLast,
      revertAt,
      clearError: () => setError(null),
    }),
    [messages, sending, error, send, revertLast, revertAt],
  );
}
