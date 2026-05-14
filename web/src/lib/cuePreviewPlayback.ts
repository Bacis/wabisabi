// Web Audio preview path for Director cues. Day 20 of the Director feature.
//
// The renderer's CueLayer (Day 19) handles final-output audio via Remotion's
// <Audio> elements. For LIVE editor preview the <Player>'s audio path is
// limited — we want sub-10ms cue firing and zero dependence on the
// browser's HTML <audio> element decoding latency. So the preview path
// uses Web Audio directly:
//
//   * decodeAudioBuffer() pre-decodes every sample into an AudioBuffer
//     and caches it. The cache is keyed by URL so the same 12 typewriter
//     ticks are decoded ONCE and reused across hundreds of cues.
//   * firePreview() spins up an AudioBufferSourceNode at the requested
//     volume and starts it immediately. No layout reflow, no <audio>
//     element churn.
//
// The hook `useCuePreview` (a small React glue function) checks on every
// frame update whether the playhead just crossed a cue's start time and
// fires it. Idempotent: firing the same cue twice in a single playback
// session is suppressed via a per-cue "lastFiredAtPlayheadSec" map.

import { useEffect, useMemo, useRef } from 'react';

// Resolved AudioCue shape — mirrors remotion/src/audio/cueTypes.ts. The
// schema-level AudioCue (in ./director) is the AUTHOR shape (gesture +
// volume + offsetMs); this is the RENDERER shape (samplePath, startFrame,
// resolved volume). Both web preview and Remotion render emit cues in
// this shape; producers live on the remotion side.
export type ResolvedAudioCue = {
  id: string;
  samplePath: string;
  startFrame: number;
  endFrame?: number;
  volume: number;
  source: 'group' | 'beat' | 'typewriter';
};

// ---------------------------------------------------------------------------
// AudioContext + decode cache. Lazy because Safari refuses to construct
// AudioContext outside a user gesture. Caller must hold off invoking
// firePreview() until the user has clicked play at least once.

let _ctx: AudioContext | null = null;
const _decodeCache = new Map<string, Promise<AudioBuffer>>();

function getCtx(): AudioContext {
  if (!_ctx) {
    // Some browsers gate AudioContext to user-gesture handlers. The
    // caller (PreviewPanel) should call this from inside an onClick;
    // outside of that, this still constructs but the resulting context
    // is suspended until resume() is called.
    _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _ctx;
}

export async function decodeAudioBuffer(url: string): Promise<AudioBuffer> {
  const existing = _decodeCache.get(url);
  if (existing) return existing;
  const p = (async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`decodeAudioBuffer: ${url} ${r.status}`);
    const arr = await r.arrayBuffer();
    return await getCtx().decodeAudioData(arr.slice(0));
  })();
  _decodeCache.set(url, p);
  return p;
}

export type FirePreviewArgs = {
  url: string;
  volume?: number;
};

export async function firePreview(args: FirePreviewArgs): Promise<void> {
  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    // No-op if we can't fire yet — the playhead crossing is fine to skip.
    try { await ctx.resume(); } catch { return; }
  }
  let buf: AudioBuffer;
  try {
    buf = await decodeAudioBuffer(args.url);
  } catch {
    return; // sample missing or decode failed — graceful skip
  }
  const source = ctx.createBufferSource();
  source.buffer = buf;
  if (args.volume !== undefined && args.volume !== 1) {
    const gain = ctx.createGain();
    gain.gain.value = args.volume;
    source.connect(gain).connect(ctx.destination);
  } else {
    source.connect(ctx.destination);
  }
  source.start();
}

// ---------------------------------------------------------------------------
// React glue. Given a cue list (already in frame coordinates) + the current
// playhead time + fps, fires cues as they cross. Maintains a per-cue
// "fired" flag for the current playback session — when the user scrubs
// backwards, the flag resets so the cue can fire again on the next pass.

export type UseCuePreviewArgs = {
  cues: ResolvedAudioCue[];
  playheadSec: number;
  playing: boolean;
  fps: number;
  /** Map of cue.samplePath → resolved public URL (e.g. /audio/thud/01.mp3). */
  resolveUrl: (samplePath: string) => string;
};

export function useCuePreview({ cues, playheadSec, playing, fps, resolveUrl }: UseCuePreviewArgs): void {
  const lastTickRef = useRef<number>(0);
  // firedAtFrame tracks the last frame the cue fired at. Re-fires only when
  // the playhead leaves and re-enters the cue's range — i.e. on scrub-back.
  const firedRef = useRef<Map<string, number>>(new Map());

  // Sort cues by startFrame so the hot path is a linear walk through a
  // narrow window of "cues that just became due."
  const sortedCues = useMemo(
    () => [...cues].sort((a, b) => a.startFrame - b.startFrame),
    [cues],
  );

  useEffect(() => {
    if (!playing) return;
    const playheadFrame = Math.round(playheadSec * fps);
    const lastFrame = lastTickRef.current;
    // Reset fired flags on a backwards scrub.
    if (playheadFrame < lastFrame) firedRef.current.clear();
    lastTickRef.current = playheadFrame;

    for (const cue of sortedCues) {
      if (cue.startFrame < lastFrame) continue;
      if (cue.startFrame > playheadFrame) break; // sorted — rest are later
      if (firedRef.current.has(cue.id)) continue;
      firedRef.current.set(cue.id, cue.startFrame);
      // Fire-and-forget; firePreview already handles its own failures.
      void firePreview({
        url: resolveUrl(cue.samplePath),
        volume: cue.volume,
      });
    }
  }, [sortedCues, playheadSec, playing, fps, resolveUrl]);
}
