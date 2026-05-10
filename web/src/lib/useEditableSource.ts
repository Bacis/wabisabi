import { useEffect, useRef, useState } from 'react';
import {
  fetchJob,
  fetchStockClip,
  fetchTheme,
  type CaptionPlan,
  type Transcript,
} from './api';

// Editor.tsx originally only knew how to load /jobs/:id (poll until the
// transcript arrives, then render). This hook generalizes that fetcher so
// the same Editor can run against:
//   - kind:'job'    — existing flow on /jobs/:id
//   - kind:'stock'  — pre-transcribed stock clip on /themes/new (no polling)
//   - kind:'theme'  — published theme on /themes/:id (read-only viewer)
//
// All three resolve to the same EditorSourceState shape so the form pane
// and PlayerPreview don't need to branch on source.kind.

export type EditorSource =
  | { kind: 'job'; jobId: string }
  | { kind: 'stock'; clipId: string }
  | { kind: 'theme'; themeId: string };

export type LoadedSource = {
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  videoSrc: string;
  durationSec: number;
  inputAvailable: boolean;
  status: 'queued' | 'running' | 'done' | 'failed';
  initialTemplateId: string;
  initialStyleSpec: Record<string, any>;
  outputUrl: string | null;
};

export type EditorSourceState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: LoadedSource };

export function useEditableSource(source: EditorSource): EditorSourceState {
  const [state, setState] = useState<EditorSourceState>({ status: 'loading' });
  // Re-fire the effect cleanly when the identifying key changes.
  const sourceKey = sourceKeyOf(source);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState({ status: 'loading' });

    const finishWith = (data: LoadedSource) => {
      if (!cancelled) setState({ status: 'ready', data });
    };
    const failWith = (err: unknown) => {
      if (!cancelled) {
        setState({ status: 'error', error: (err as Error).message });
      }
    };

    const current = sourceRef.current;

    if (current.kind === 'stock') {
      fetchStockClip(current.clipId)
        .then((clip) => {
          finishWith({
            transcript: clip.transcript,
            captionPlan: clip.captionPlan,
            videoSrc: clip.src,
            durationSec: clip.transcript.duration ?? clip.durationSec ?? 0,
            inputAvailable: true,
            status: 'done',
            initialTemplateId: 'reel-clone',
            initialStyleSpec: {},
            outputUrl: null,
          });
        })
        .catch(failWith);
      return () => {
        cancelled = true;
      };
    }

    if (current.kind === 'theme') {
      fetchTheme(current.themeId)
        .then((theme) => {
          if (!theme.showcaseClip) {
            failWith(new Error('this theme has no showcase clip yet'));
            return;
          }
          finishWith({
            transcript: theme.showcaseClip.transcript,
            captionPlan: theme.showcaseClip.captionPlan,
            videoSrc: theme.showcaseClip.src,
            durationSec:
              theme.showcaseClip.transcript.duration ??
              theme.showcaseClip.durationSec ??
              0,
            inputAvailable: true,
            status: 'done',
            initialTemplateId: theme.templateId,
            initialStyleSpec: theme.styleSpec,
            outputUrl: null,
          });
        })
        .catch(failWith);
      return () => {
        cancelled = true;
      };
    }

    // Job kind: poll /jobs/:id until the transcript arrives, then stop.
    const jobId = current.jobId;
    let seeded = false;
    const tick = async () => {
      try {
        const j = await fetchJob(jobId);
        if (cancelled) return;
        if (!seeded) {
          if (j.transcript) {
            seeded = true;
            finishWith({
              transcript: j.transcript,
              captionPlan: j.captionPlan,
              videoSrc: `/jobs/${jobId}/input`,
              durationSec: j.transcript.duration ?? 0,
              inputAvailable: j.inputAvailable,
              status: j.status,
              initialTemplateId: j.templateId,
              initialStyleSpec: j.styleSpec ?? {},
              outputUrl: j.status === 'done' ? `/jobs/${jobId}/output` : null,
            });
            return;
          }
        }
        if (j.status !== 'failed') {
          timer = setTimeout(tick, 2000);
        } else {
          failWith(new Error(`job failed at stage ${j.stage ?? 'unknown'}`));
        }
      } catch (err) {
        failWith(err);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  return state;
}

function sourceKeyOf(source: EditorSource): string {
  switch (source.kind) {
    case 'job':
      return `job:${source.jobId}`;
    case 'stock':
      return `stock:${source.clipId}`;
    case 'theme':
      return `theme:${source.themeId}`;
  }
}
