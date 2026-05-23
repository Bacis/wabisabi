// rAF-driven playback hook. Returns a 0..1 progress, the current
// millisecond, transport controls, and fires onComplete when reaching the
// end. Speed > 0 scales time; resuming from pause uses the same
// `start = now - elapsed/speed*1000` math the HTML uses, so seeking and
// speed changes don't jump.

import { useCallback, useEffect, useRef, useState } from 'react';

export type PlaybackOptions = {
  durationMs: number;
  speed: number;
  playing: boolean;
  // Fires once per cycle when progress reaches 1. The hook does NOT auto-loop —
  // the parent decides what to do (advance to next scene, hold the final
  // frame, etc.). To replay the same scene, the parent should bump a key
  // upstream and reset progress.
  onComplete?: () => void;
};

export type PlaybackHandle = {
  progress: number; // 0..1
  currentMs: number;
  seek: (ms: number) => void;
  reset: () => void;
};

export function usePlayback(opts: PlaybackOptions): PlaybackHandle {
  const { durationMs, speed, playing, onComplete } = opts;
  const [progress, setProgress] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);

  // Refs persist across renders without causing them.
  const startRef = useRef<number | null>(null);
  const lastTickMsRef = useRef(0);
  const completedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(speed);
  const playingRef = useRef(playing);
  const onCompleteRef = useRef(onComplete);
  const durationRef = useRef(durationMs);

  speedRef.current = speed;
  playingRef.current = playing;
  onCompleteRef.current = onComplete;
  durationRef.current = durationMs;

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(durationRef.current, ms));
    lastTickMsRef.current = clamped;
    completedRef.current = clamped >= durationRef.current;
    if (playingRef.current) {
      startRef.current = performance.now() - clamped / speedRef.current;
    } else {
      startRef.current = null;
    }
    setCurrentMs(clamped);
    setProgress(
      durationRef.current > 0 ? clamped / durationRef.current : 0,
    );
  }, []);

  const reset = useCallback(() => {
    seek(0);
  }, [seek]);

  // Main rAF loop — single, persistent. Reads refs so speed/playing/duration
  // changes don't tear it down.
  useEffect(() => {
    const tick = (now: number) => {
      if (playingRef.current) {
        if (startRef.current === null) {
          startRef.current = now - lastTickMsRef.current / speedRef.current;
        }
        const elapsedMs = (now - startRef.current) * speedRef.current;
        const dur = durationRef.current;
        if (dur > 0 && elapsedMs >= dur) {
          if (!completedRef.current) {
            completedRef.current = true;
            lastTickMsRef.current = dur;
            setCurrentMs(dur);
            setProgress(1);
            onCompleteRef.current?.();
          }
        } else {
          completedRef.current = false;
          lastTickMsRef.current = elapsedMs;
          setCurrentMs(elapsedMs);
          setProgress(dur > 0 ? elapsedMs / dur : 0);
        }
      } else {
        // Paused — keep start aligned so resume picks up where we left off.
        startRef.current = null;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return { progress, currentMs, seek, reset };
}
