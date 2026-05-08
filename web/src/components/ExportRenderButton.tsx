import { useEffect, useState } from 'react';
import { fetchJob, submitRender, type JobDetail } from '../lib/api';

type Props = {
  sourceJobId: string;
  templateId: string;
  styleSpec: Record<string, any>;
  // Source input still on disk? Re-using a swept input 410s server-side,
  // so we disable instead of letting the click fail.
  inputAvailable: boolean;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'rendering'; jobId: string; job: JobDetail | null }
  | { kind: 'downloading'; jobId: string }
  | { kind: 'error'; message: string };

export function ExportRenderButton({
  sourceJobId,
  templateId,
  styleSpec,
  inputAvailable,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // Two separate effects keyed off scalar values (not the discriminated
  // union) so cleanup boundaries line up cleanly with the phase changes —
  // a single combined effect makes it easy to leak a stale `cancelled`
  // flag across phase transitions.
  const renderingJobId = phase.kind === 'rendering' ? phase.jobId : null;
  const downloadingJobId = phase.kind === 'downloading' ? phase.jobId : null;

  // Poll the queued job. When done, hop to the downloading phase; when
  // failed, hop to the error phase.
  useEffect(() => {
    if (renderingJobId == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const job = await fetchJob(renderingJobId);
        if (cancelled) return;
        if (job.status === 'failed') {
          setPhase({ kind: 'error', message: 'Render failed on the worker.' });
          return;
        }
        if (job.status === 'done') {
          setPhase({ kind: 'downloading', jobId: renderingJobId });
          return;
        }
        setPhase({ kind: 'rendering', jobId: renderingJobId, job });
        timer = setTimeout(tick, 2000);
      } catch (err) {
        if (!cancelled) {
          setPhase({ kind: 'error', message: (err as Error).message });
        }
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [renderingJobId]);

  // Once the job is done, fetch the rendered mp4 and trigger an automatic
  // browser download. Closing the modal during this step (Hide button)
  // doesn't actually cancel the download — it's just released to the
  // browser's download manager and we land back on idle.
  useEffect(() => {
    if (downloadingJobId == null) return;
    let cancelled = false;

    (async () => {
      try {
        await downloadOutput(downloadingJobId);
        if (!cancelled) setPhase({ kind: 'idle' });
      } catch (err) {
        if (!cancelled) {
          setPhase({ kind: 'error', message: (err as Error).message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [downloadingJobId]);

  const submit = async () => {
    setPhase({ kind: 'submitting' });
    try {
      const { id } = await submitRender({
        sourceJobId,
        templateId,
        styleSpec,
        keepInputMinutes: 60,
      });
      setPhase({ kind: 'rendering', jobId: id, job: null });
    } catch (err) {
      setPhase({ kind: 'error', message: (err as Error).message });
    }
  };

  const close = () => setPhase({ kind: 'idle' });

  const buttonLabel =
    phase.kind === 'submitting' ? 'Submitting…'
    : phase.kind === 'rendering' || phase.kind === 'downloading' ? 'Rendering…'
    : 'Export render';
  const disabled =
    phase.kind === 'submitting' ||
    phase.kind === 'rendering' ||
    phase.kind === 'downloading' ||
    !inputAvailable;

  return (
    <>
      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        title={!inputAvailable ? 'Source input expired — re-upload to render again' : undefined}
        className="text-xs font-medium px-3 py-1.5 rounded bg-amber-400 text-ink-900 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonLabel}
      </button>
      {(phase.kind === 'rendering' || phase.kind === 'downloading') && (
        <RenderModal phase={phase} onClose={close} />
      )}
      {phase.kind === 'error' && <ErrorModal message={phase.message} onClose={close} />}
    </>
  );
}

function RenderModal({
  phase,
  onClose,
}: {
  phase: Extract<Phase, { kind: 'rendering' } | { kind: 'downloading' }>;
  onClose: () => void;
}) {
  const stage =
    phase.kind === 'downloading' ? 'downloading'
    : phase.job?.stage ?? phase.job?.status ?? 'queued';
  const progress = phase.kind === 'rendering' ? extractPercent(phase.job) : 100;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-ink-800 border border-ink-700 rounded-lg p-6 max-w-sm w-full shadow-xl">
        <h2 className="text-sm font-semibold text-ink-100 mb-1">
          {phase.kind === 'downloading' ? 'Saving render…' : 'Rendering your clip…'}
        </h2>
        <p className="text-[11px] text-ink-400 mb-4">
          You can keep editing — the download will start automatically when it's ready.
        </p>
        <div className="flex items-center justify-between text-[11px] font-mono text-ink-300 mb-1.5">
          <span>{stage}</span>
          <span>{progress != null ? `${progress}%` : '…'}</span>
        </div>
        <div className="h-2 bg-ink-700 rounded overflow-hidden">
          <div
            className="h-full bg-amber-400 transition-all duration-500"
            style={{ width: progress != null ? `${progress}%` : '8%' }}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full text-xs text-ink-400 hover:text-ink-200 transition-colors"
        >
          Hide (render keeps running in the background)
        </button>
      </div>
    </div>
  );
}

function ErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-ink-800 border border-rose-400/40 rounded-lg p-6 max-w-sm w-full shadow-xl">
        <h2 className="text-sm font-semibold text-rose-200 mb-2">Export failed</h2>
        <p className="text-xs text-ink-300 break-words">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full text-xs px-3 py-1.5 rounded bg-ink-700 hover:bg-ink-600 text-ink-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// Pull a 0–100 number out of the worker's progress JSON. Both renderLocal
// and renderLambda emit `{ percent: number, ... }`; absent percent (transcribe/
// enrich stages) returns null and the bar shows an indeterminate sliver.
function extractPercent(job: JobDetail | null): number | null {
  if (!job) return null;
  const p = (job as unknown as { progress?: { percent?: number } }).progress;
  if (!p || typeof p.percent !== 'number') return null;
  return Math.max(0, Math.min(100, Math.round(p.percent)));
}

// Trigger a save via plain anchor click. We can't `fetch` + blob the
// output because the API redirects to a presigned S3 URL — that fetch
// would be cross-origin and S3 doesn't return CORS headers. Instead we
// pass `?download=<name>` so the server (or S3, via the signed URL's
// ResponseContentDisposition override) returns Content-Disposition:
// attachment, and the browser saves the file when the anchor click
// follows the redirect.
async function downloadOutput(jobId: string) {
  const filename = `caption-render-${jobId.slice(0, 8)}.mp4`;
  const a = document.createElement('a');
  a.href = `/jobs/${jobId}/output?download=${encodeURIComponent(filename)}`;
  // Same-origin hint — even without it the attachment Content-Disposition
  // would force a save, but this keeps the no-S3-CD case (local mode)
  // working too.
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
