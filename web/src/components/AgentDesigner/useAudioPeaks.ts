// Decode the source video's audio track in the browser and downsample it
// to a fixed-bucket peaks array suitable for waveform rendering.
//
// One-shot per src: the decode is expensive (Web Audio API decodes the
// entire file, then we walk the channel data), so we cache the result
// in a module-scope Map keyed by src+bucketCount. Re-mounting the
// timeline against the same clip is instant on the second visit.
//
// Concurrency: the FIRST caller for an unseen src fires the decode; any
// later caller arriving while the decode is in-flight reuses the same
// Promise so we never decode twice in parallel.

import { useEffect, useState } from 'react';

export type Peaks = {
  /** Min/max pairs, [min0, max0, min1, max1, ...] — length = 2 * bucketCount. */
  data: Float32Array;
  bucketCount: number;
};

const peakCache = new Map<string, Promise<Peaks>>();

function cacheKey(src: string, bucketCount: number) {
  return `${src}::${bucketCount}`;
}

async function decodePeaks(src: string, bucketCount: number): Promise<Peaks> {
  const res = await fetch(src, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch ${src}: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  // Lazily construct a context — chrome requires a user gesture only for
  // playback, not for decode. We instantiate, decode, then close.
  const Ctor: typeof AudioContext =
    (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const audio = await ctx.decodeAudioData(arrayBuf.slice(0));
    const ch = audio.getChannelData(0);
    const samplesPerBucket = Math.max(1, Math.floor(ch.length / bucketCount));
    const out = new Float32Array(bucketCount * 2);
    for (let b = 0; b < bucketCount; b++) {
      const start = b * samplesPerBucket;
      const end = Math.min(ch.length, start + samplesPerBucket);
      let min = 0;
      let max = 0;
      for (let i = start; i < end; i++) {
        const v = ch[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[b * 2] = min;
      out[b * 2 + 1] = max;
    }
    return { data: out, bucketCount };
  } finally {
    // Release decoder resources promptly — we have what we need.
    ctx.close?.();
  }
}

export function useAudioPeaks(
  src: string | null | undefined,
  bucketCount = 600,
): { peaks: Peaks | null; loading: boolean; error: string | null } {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [loading, setLoading] = useState<boolean>(!!src);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setPeaks(null);
      setLoading(false);
      setError(null);
      return;
    }
    const key = cacheKey(src, bucketCount);
    let cancelled = false;
    setLoading(true);
    setError(null);
    let p = peakCache.get(key);
    if (!p) {
      p = decodePeaks(src, bucketCount);
      peakCache.set(key, p);
      // Drop the cache entry on failure so a later retry can re-decode.
      p.catch(() => peakCache.delete(key));
    }
    p.then((result) => {
      if (cancelled) return;
      setPeaks(result);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError((err as Error).message);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [src, bucketCount]);

  return { peaks, loading, error };
}
