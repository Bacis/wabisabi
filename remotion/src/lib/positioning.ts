// Face-aware caption positioning. Shared between PopWords and SingleWord
// (and any future template) — flips the caption to the opposite side of the
// frame when the speaker's face would be covered.
//
// The face data is sampled at ~4fps by the worker stage `detectFaces`. For
// each rendered frame we look up the closest sample, pick the largest face
// (the speaker, by area), and decide whether the caption should sit at the
// top or bottom of the frame based on where the face is.

export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

export type FaceSample = {
  time: number;
  faces: FaceBox[];
};

export type FaceData = {
  videoWidth: number;
  videoHeight: number;
  videoFps: number;
  videoDuration: number;
  samples: FaceSample[];
};

export type Position = 'top' | 'middle' | 'bottom';

export function findClosestSample(
  faces: FaceData | null,
  t: number,
): FaceSample | null {
  if (!faces || faces.samples.length === 0) return null;
  let best = faces.samples[0]!;
  let bestDist = Math.abs(best.time - t);
  for (const s of faces.samples) {
    const d = Math.abs(s.time - t);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

// Flip the caption to the opposite side of the frame when the speaker's face
// would be covered. Conservative: only override when the face is clearly in
// the upper or lower portion (not in the middle band where any choice would
// risk overlap). Returns the user's preferred position when there's no face,
// when the face is centered, or when preferred is 'middle'.
export function pickPositionFromFaceCenter(
  faceCenterY: number | null,
  preferred: Position,
): Position {
  if (faceCenterY == null || preferred === 'middle') return preferred;
  // Face in lower 40% of frame → caption at top (avoid covering it)
  if (faceCenterY > 0.6) return 'top';
  // Face in upper 40% → caption at bottom (default for talking-head shots)
  if (faceCenterY < 0.4) return 'bottom';
  // Face in the middle band → don't override
  return preferred;
}

export function effectivePosition(
  faces: FaceData | null,
  t: number,
  preferred: Position,
): Position {
  const sample = findClosestSample(faces, t);
  if (!sample || sample.faces.length === 0) return preferred;
  // Use the largest face by area — that's the speaker if there are multiple
  // people (or stray detections in the background).
  const largest = sample.faces.reduce((a, b) =>
    a.width * a.height > b.width * b.height ? a : b,
  );
  const centerY = largest.y + largest.height / 2;
  return pickPositionFromFaceCenter(centerY, preferred);
}
