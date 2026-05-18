// /designer/new + /designer/:id step 2: agentic CaptionDesigner. Loads the
// picked source (stock clip or job) into the editor store, then renders the
// cinematic workspace with the chat panel replacing the form pane.
//
// Mirrors CaptionDesigner/index.tsx so the source loading lifecycle is
// identical — only the layout + chat pane differ.

import { useEffect, useState } from 'react';
import { useEditableSource, type EditorSource } from '@/lib/useEditableSource';
import { useEditor } from '@/lib/editor/store';
import { buildInitialState } from '@/lib/editor/loadFromSource';
import { useKeyboard } from '@/components/preview/useKeyboard';
import { AgentWorkspace } from './AgentWorkspace';
import { WorkspaceSkeleton } from './WorkspaceSkeleton';
import { HeaderActions } from './HeaderActions';
import type { UseAgentChatOpts } from '@/components/AgentChatPane/useAgentChat';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

export function AgentDesigner({
  source,
  chatOpts,
  // Optional override for the loaded styleSpec — used by /designer/:id to
  // restore the user's last-saved spec instead of the source's default.
  // Wins over loaded.data.initialStyleSpec exactly once, on the same load.
  initialStyleSpecOverride,
  // Optional override for the loaded directorScript — used by /designer/:id
  // to restore the agent's whole-video scene plan. loadDesign always nulls
  // directorScript (a general-purpose entry-point default), so we apply
  // this override in a follow-up setState once the source is ready.
  initialDirectorScript,
  // Optional first chat turn fired automatically on mount — used by the
  // Start page so the user's homepage prompt seeds the agent without a
  // second submit step.
  initialPrompt,
}: {
  source: EditorSource;
  chatOpts?: UseAgentChatOpts;
  initialStyleSpecOverride?: Record<string, unknown> | null;
  initialDirectorScript?: unknown | null;
  initialPrompt?: string;
}) {
  const loaded = useEditableSource(source);
  const loadDesign = useEditor((s) => s.loadDesign);
  const setDirectorScript = useEditor((s) => s.setDirectorScript);
  // True once loadDesign has seeded the editor for the current source.
  // We gate initialPrompt on this so the auto-submit in AgentChatPane never
  // fires against a stale (pre-load) styleSpec — children's effects run
  // before the parent's, which would otherwise race the editor seed.
  const [editorReady, setEditorReady] = useState(false);
  useKeyboard();

  useEffect(() => {
    if (loaded.status !== 'ready') return;
    const persisted = buildInitialState({
      videoSrc: loaded.data.videoSrc,
      transcript: loaded.data.transcript,
      durationSec: loaded.data.durationSec,
    });
    // The agent's tool surface (apply_preset_pack, set_effect, set_layout_strategy,
    // apply_style_patch, tune_field) is fully wired against reel-clone's StyleSpec
    // schema. Forcing the template here means the agent always has consistent
    // semantics regardless of what the source's initialTemplateId resolved to —
    // users never have to think about template families. Caption Designer
    // template remains available for the manual editor flow at /jobs/*.
    loadDesign({
      persisted,
      source:
        source.kind === 'stock'
          ? { kind: 'stock', clipId: source.clipId }
          : source.kind === 'job'
            ? { kind: 'job', jobId: source.jobId }
            : null,
      designId: null,
      designName: 'Untitled · Agent',
      templateId: 'reel-clone',
      styleSpec: initialStyleSpecOverride ?? loaded.data.initialStyleSpec,
      transcriptText: persisted.transcriptText,
      // Surface the source's intrinsic dims so the editor opens in the
      // matching canvas aspect. Falls back to 1080×1920 inside loadDesign
      // when either is missing (legacy jobs / stock clips without dims).
      canvasWidth: loaded.data.widthPx ?? undefined,
      canvasHeight: loaded.data.heightPx ?? undefined,
    });
    // loadDesign always clears directorScript (Day 16 default for a fresh
    // load). When we're resuming a saved session that had a Director plan,
    // re-apply it now so the timeline groups lane + renderer pick it back
    // up. Cast via unknown — the store type is DirectorScript|null, and
    // we accept the same JSON shape the server round-trips.
    if (initialDirectorScript) {
      setDirectorScript(initialDirectorScript as Parameters<typeof setDirectorScript>[0]);
    }
    setEditorReady(true);
  }, [
    loaded.status,
    loadDesign,
    setDirectorScript,
    source,
    initialStyleSpecOverride,
    initialDirectorScript,
  ]);

  if (loaded.status === 'loading') {
    // Keep the editor chrome visible during source prep — the chat zone
    // shows the user's prompt as a sent bubble + a "wabisabi is
    // preparing" indicator, the preview + timeline get shimmer
    // placeholders. As soon as loaded.status flips to 'ready' the real
    // AgentWorkspace replaces the skeleton in-place (same grid).
    //
    // Loaded.data isn't available yet (we're still loading), but
    // useEditableSource exposes status+error only — there's no
    // partial-data state to read dims from until 'ready'. Skeleton
    // defaults to 9:16, which is correct for stock clips. The aspect
    // will pop to the real one once the editor opens; that's mid-load
    // anyway so the visual shift is brief.
    return (
      <div className={styles.root}>
        <HeaderActions />
        <WorkspaceSkeleton initialPrompt={initialPrompt} />
      </div>
    );
  }
  if (loaded.status === 'error') {
    return <div className={styles.errorBox}>{loaded.error}</div>;
  }

  // `.root` locks the workspace to the outlet's height so the preview /
  // timeline stay size-stable; only `.chatBody` scrolls internally.
  return (
    <div className={styles.root}>
      <HeaderActions />
      <AgentWorkspace
        chatOpts={chatOpts}
        initialPrompt={editorReady ? initialPrompt : undefined}
      />
    </div>
  );
}
