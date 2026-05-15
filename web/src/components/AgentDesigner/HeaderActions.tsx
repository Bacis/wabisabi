// Save / Render buttons for the agent designer. Mounts into AtelierShell's
// page-actions portal so the workspace doesn't need its own header row.
//
// The render flow is inline (no navigation): once the user clicks Render we
// POST /designs/:id/render to mint a job, poll fetchJob every 2s until the
// status terminates, and surface progress / download / error right in the
// header. Previously this navigated to /jobs/:id, but that route was retired
// when the Render Ledger was replaced by the curated /library page — popping
// the user out of their conversation was disruptive UX anyway.

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Check, Loader2, Download, AlertCircle } from 'lucide-react';
import { Button, PageActions, MonoLabel } from '@/components/atelier';
import { useEditor } from '@/lib/editor/store';
import { serializeState } from '@/lib/editor/serialize';
import {
  createDesign,
  fetchJob,
  patchDesign,
  renderDesign,
  type JobDetail,
} from '@/lib/api';

type RenderState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'running'; jobId: string; stage: string | null }
  | { kind: 'done'; jobId: string }
  | { kind: 'failed'; jobId: string | null; error: string };

// Sanitize the editor's design name into a safe download filename. Replaces
// any non-[A-Za-z0-9_-] run with a single dash, collapses repeats, trims
// leading/trailing dashes, and tacks on the short job id so two renders of
// the same session don't overwrite each other in the user's download folder.
function buildDownloadName(designName: string, jobId: string): string {
  const slug = designName
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const stem = slug.length > 0 ? slug : 'caption-render';
  return `${stem}-${jobId.slice(0, 8)}.mp4`;
}

export function HeaderActions() {
  const designId = useEditor((s) => s.designId);
  const designName = useEditor((s) => s.designName);
  const source = useEditor((s) => s.source);
  const setDesignId = useEditor((s) => s.setDesignId);

  const [saving, setSaving] = useState(false);
  const [renderState, setRenderState] = useState<RenderState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  // Tracks the most recent poll abort so leaving the page or starting a new
  // render cleans up the previous interval.
  const pollAbortRef = useRef<{ stopped: boolean } | null>(null);

  useEffect(() => () => {
    if (pollAbortRef.current) pollAbortRef.current.stopped = true;
  }, []);

  // Save the editor state into the designs table (POST /designs or PATCH).
  // Returns the resolved designId so the caller can chain a render.
  async function saveDesignNow(): Promise<string | null> {
    if (!source) return null;
    const state = serializeState(useEditor.getState());
    const existingId = useEditor.getState().designId;
    if (existingId) {
      await patchDesign(existingId, { name: designName, state });
      return existingId;
    }
    const sourceKind = source.kind;
    const sourceId = source.kind === 'stock' ? source.clipId : source.jobId;
    const created = await createDesign({
      name: designName,
      sourceKind,
      sourceId,
      state,
    });
    setDesignId(created.id);
    return created.id;
  }

  async function onSave() {
    if (!source) return;
    setError(null);
    setSaving(true);
    try {
      await saveDesignNow();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Poll a job until it leaves 'queued' / 'running'. Updates renderState on
  // each successful fetch; stops when the page is unmounted or a new render
  // supersedes this one.
  function startPolling(jobId: string) {
    if (pollAbortRef.current) pollAbortRef.current.stopped = true;
    const abort = { stopped: false };
    pollAbortRef.current = abort;
    const tick = async () => {
      if (abort.stopped) return;
      let job: JobDetail;
      try {
        job = await fetchJob(jobId);
      } catch (err) {
        if (abort.stopped) return;
        setRenderState({
          kind: 'failed',
          jobId,
          error: (err as Error).message,
        });
        return;
      }
      if (abort.stopped) return;
      if (job.status === 'done') {
        setRenderState({ kind: 'done', jobId });
        return;
      }
      if (job.status === 'failed') {
        setRenderState({
          kind: 'failed',
          jobId,
          error: job.stage ? `failed at ${job.stage}` : 'render failed',
        });
        return;
      }
      setRenderState({ kind: 'running', jobId, stage: job.stage });
      window.setTimeout(tick, 2000);
    };
    void tick();
  }

  async function onRender() {
    if (!source) return;
    setError(null);
    setRenderState({ kind: 'submitting' });
    try {
      // Always re-save before render so the design row reflects the user's
      // latest agent edits. Previously this short-circuited if `designId`
      // was already set, which meant the SECOND and later renders used the
      // STALE state from the first save — none of the chunkOverrides or
      // styleSpec tweaks the user added between renders made it into the
      // rendered MP4.
      const id = await saveDesignNow();
      if (!id) {
        setRenderState({ kind: 'idle' });
        return;
      }
      const { id: jobId } = await renderDesign(id);
      setRenderState({ kind: 'running', jobId, stage: null });
      startPolling(jobId);
    } catch (err) {
      setRenderState({
        kind: 'failed',
        jobId: null,
        error: (err as Error).message,
      });
    }
  }

  const rendering =
    renderState.kind === 'submitting' || renderState.kind === 'running';

  return (
    <PageActions>
      {error && (
        <MonoLabel tone="danger" dot>
          {error}
        </MonoLabel>
      )}
      {renderState.kind === 'running' && renderState.stage && (
        <MonoLabel tone="cyan" dot>
          {renderState.stage}
        </MonoLabel>
      )}
      {renderState.kind === 'failed' && (
        <MonoLabel tone="danger" dot>
          {renderState.error}
        </MonoLabel>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onSave}
        disabled={saving || rendering}
        leadingIcon={
          saving ? (
            <Loader2 size={12} className="atelier-spin" />
          ) : (
            <Check size={12} />
          )
        }
      >
        {saving ? 'Saving' : 'Save'}
      </Button>
      {/*
        Render button is ALWAYS present so the user can re-render after every
        agent edit. Previously this slot was a state-driven Render | Retry |
        Download switch — but the moment the first render finished, the
        Render button vanished and was replaced by Download. There was no way
        to queue a new render until the user reloaded the page, and any
        subsequent "tune the strokes / change the palette / etc." agent
        turns silently couldn't be exported. Download lives in its own slot
        AFTER Render, alongside the latest finished render's link.
      */}
      <Button
        size="sm"
        variant={renderState.kind === 'failed' ? 'ghost' : 'primary'}
        onClick={onRender}
        disabled={rendering || saving}
        leadingIcon={
          rendering ? (
            <Loader2 size={12} className="atelier-spin" />
          ) : renderState.kind === 'failed' ? (
            <AlertCircle size={12} />
          ) : (
            <Sparkles size={12} />
          )
        }
      >
        {renderState.kind === 'submitting'
          ? 'Queueing'
          : renderState.kind === 'running'
            ? 'Rendering'
            : renderState.kind === 'failed'
              ? 'Retry'
              : renderState.kind === 'done'
                ? 'Render again'
                : 'Render'}
      </Button>
      {renderState.kind === 'done' && (
        <Button
          as="a"
          size="sm"
          variant="primary"
          // The output endpoint streams the S3-stored mp4 server-side when
          // `?download=<name>` is set, returning a same-origin response with
          // `Content-Disposition: attachment` — the browser saves the file
          // silently with no URL-bar change and no tab flash. The download
          // attribute is a same-origin signal to Chrome that the click is
          // intended as a save (some Chrome versions need it even when the
          // header is set).
          href={`/jobs/${renderState.jobId}/output?download=${encodeURIComponent(
            buildDownloadName(designName, renderState.jobId),
          )}`}
          download={buildDownloadName(designName, renderState.jobId)}
          leadingIcon={<Download size={12} />}
        >
          Download
        </Button>
      )}
    </PageActions>
  );
}
