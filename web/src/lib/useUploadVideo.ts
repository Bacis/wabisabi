import { useRef, useState, type InputHTMLAttributes, type Ref } from 'react';
import {
  finalizeUpload,
  initUpload,
  type UserVideo,
} from './api';

export type UploadVideoInputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref: Ref<HTMLInputElement>;
};

export type UploadVideoState = {
  busy: boolean;
  // 0..1 progress across the S3 PUT phase. null when idle.
  progress: number | null;
  error: string | null;
  // The file the user picked. Stays set through the eager upload; cleared
  // only on success (after run()) or explicit clear().
  staged: File | null;
  // Open the OS file picker. Picking immediately starts an eager upload
  // in the background — by the time the user submits, the bytes are
  // usually already on S3 and run() resolves instantly.
  pickFile: () => void;
  // Discard the staged file and abort any in-flight upload.
  clear: () => void;
  // Resolve the final user_video. If the eager upload has already
  // finished, returns instantly. If it's mid-flight, awaits it. Returns
  // null when no file is staged. Throws on upload failure.
  run: () => Promise<UserVideo | null>;
  // Hidden <input type="file"> — must be rendered somewhere in the tree
  // for pickFile() to have a target. Spread on a hidden input.
  inputProps: UploadVideoInputProps;
};

// Two-phase upload hook with EAGER execution. The moment the user picks
// a file, we kick off the upload in the background:
//
//   1. POST /uploads/init        → reserve a row, get a presigned PUT URL
//   2. PUT file directly to S3   → bytes bypass our Fastify container
//   3. POST /uploads/:id/finalize → server HEADs S3 + flips status to 'ready'
//
// Probe (videoWidth/height/duration) runs in PARALLEL with init+PUT so
// the user-perceived latency is dominated by the network upload, not
// metadata reads.
//
// Eager upload lets the user type their prompt while bytes are in flight,
// so by the time they hit submit, run() typically resolves instantly.
// If they change their mind, clear() aborts the XHR — bytes already sent
// are wasted, but the user can replace the file before submit without
// blocking on the previous upload finishing.
export function useUploadVideo(): UploadVideoState {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The in-flight (or completed) upload for the currently-staged file.
  // We hold the promise + the XHR so run() can await + clear() can abort.
  type Inflight = {
    file: File;
    promise: Promise<UserVideo>;
    xhr: XMLHttpRequest | null;
    aborted: boolean;
  };
  const inflightRef = useRef<Inflight | null>(null);

  function clear() {
    const cur = inflightRef.current;
    if (cur && cur.xhr) {
      cur.aborted = true;
      try {
        cur.xhr.abort();
      } catch {
        // ignore — abort() on a finished xhr no-ops
      }
    }
    inflightRef.current = null;
    setStaged(null);
    setProgress(null);
    setError(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function startUpload(file: File): Inflight {
    // Tracked outside the async so clear() can abort it.
    const tracking: Inflight = {
      file,
      xhr: null,
      promise: null as unknown as Promise<UserVideo>, // populated below
      aborted: false,
    };

    setBusy(true);
    setError(null);
    setProgress(0);

    // Kick off the local metadata probe in parallel with init + PUT.
    // It only reads file headers (no network), so it almost always
    // finishes before the PUT does — keeping the timing critical-path
    // dominated by bandwidth, not JS.
    const probePromise = probeMetadata(file).catch(() => null);

    tracking.promise = (async () => {
      try {
        const init = await initUpload({
          filename: file.name,
          mimeType: file.type || 'video/mp4',
          sizeBytes: file.size,
        });

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          tracking.xhr = xhr;
          xhr.open('PUT', init.putUrl);
          xhr.setRequestHeader('Content-Type', init.contentType);
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) setProgress(ev.loaded / ev.total);
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setProgress(1);
              resolve();
            } else {
              reject(new Error(`S3 PUT ${xhr.status}: ${xhr.statusText || 'upload failed'}`));
            }
          };
          xhr.onerror = () => reject(new Error('S3 PUT network error'));
          xhr.onabort = () => reject(new Error('upload aborted'));
          xhr.send(file);
        });

        const probed = await probePromise;
        const video = await finalizeUpload(init.uploadId, {
          durationSec: probed?.durationSec ?? undefined,
          widthPx: probed?.widthPx ?? undefined,
          heightPx: probed?.heightPx ?? undefined,
        });

        // Mark the network leg as done; keep staged set so the consumer
        // can read the staged File until clear() runs.
        setBusy(false);
        // Hold the terminal progress briefly so the UI can animate
        // 100% before going idle.
        window.setTimeout(() => setProgress(null), 400);
        return video;
      } catch (err) {
        setBusy(false);
        setProgress(null);
        // Only surface the error if WE care about this upload — if the
        // user already cleared/replaced, the abort caused this throw and
        // they don't need to see it.
        if (!tracking.aborted) {
          setError((err as Error).message);
        }
        throw err;
      }
    })();

    return tracking;
  }

  function pickFile() {
    inputRef.current?.click();
  }

  async function run(): Promise<UserVideo | null> {
    const cur = inflightRef.current;
    if (!cur) return null;
    // Just await the in-flight (or already-resolved) promise. After
    // success, clear staging so a subsequent submit doesn't re-upload.
    const video = await cur.promise;
    inflightRef.current = null;
    setStaged(null);
    if (inputRef.current) inputRef.current.value = '';
    return video;
  }

  return {
    busy,
    progress,
    error,
    staged,
    pickFile,
    clear,
    run,
    inputProps: {
      ref: inputRef,
      type: 'file',
      accept: 'video/*',
      className: 'hidden',
      onChange: (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        // Replacing a file: abort the previous upload before kicking off
        // the new one. Same semantics as clear() then pick.
        const prev = inflightRef.current;
        if (prev && prev.xhr) {
          prev.aborted = true;
          try {
            prev.xhr.abort();
          } catch {
            // ignore
          }
        }
        setStaged(f);
        setError(null);
        inflightRef.current = startUpload(f);
      },
    },
  };
}

// Read duration + intrinsic pixel dimensions from a video file using an
// off-DOM <video> element. The browser only needs the metadata atom, not
// the full body, so this is fast even for large files. URL is revoked
// once the metadata is read.
type ProbedMetadata = {
  durationSec: number | undefined;
  widthPx: number | undefined;
  heightPx: number | undefined;
};
function probeMetadata(file: File): Promise<ProbedMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
    };
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : undefined;
      const w = Number.isFinite(v.videoWidth) && v.videoWidth > 0 ? v.videoWidth : undefined;
      const h = Number.isFinite(v.videoHeight) && v.videoHeight > 0 ? v.videoHeight : undefined;
      cleanup();
      resolve({ durationSec: d, widthPx: w, heightPx: h });
    };
    v.onerror = () => {
      cleanup();
      reject(new Error('could not read video metadata'));
    };
    v.src = url;
  });
}
