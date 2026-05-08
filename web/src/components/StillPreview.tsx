import { useEffect, useRef, useState } from 'react';
import { fetchPreviewPng } from '../lib/api';
import { useDebounced } from '../lib/useDebounced';

type Props = {
  jobId: string;
  styleSpec: Record<string, any>;
  templateId: string;
  frameSec: number;
};

export function StillPreview({ jobId, styleSpec, templateId, frameSec }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  // Debounce styleSpec changes so dragging a slider doesn't fire 60 requests.
  // 350ms feels responsive (faster than the existing viewer's 500ms) while
  // still letting the user finish a slider drag before kicking the renderer.
  const debounced = useDebounced({ styleSpec, templateId, frameSec }, 350);

  useEffect(() => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    setLoading(true);
    setError(null);
    fetchPreviewPng({
      jobId,
      styleSpec: debounced.styleSpec,
      templateId: debounced.templateId,
      frameSec: debounced.frameSec,
      signal: ctl.signal,
    })
      .then((blob) => {
        if (ctl.signal.aborted) return;
        const objectUrl = URL.createObjectURL(blob);
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        setError(err.message ?? 'preview failed');
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [jobId, debounced.styleSpec, debounced.templateId, debounced.frameSec]);

  // Final cleanup of last URL on unmount.
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative aspect-[9/16] w-full max-w-[420px] mx-auto bg-ink-800 rounded-lg overflow-hidden border border-ink-700">
      {url ? (
        <img
          src={url}
          alt="preview"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-sm">
          {error ? <span className="text-rose-300 px-4 text-center">{error}</span> : 'rendering…'}
        </div>
      )}
      {loading && (
        <div className="absolute top-2 right-2 h-4 w-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      )}
    </div>
  );
}
