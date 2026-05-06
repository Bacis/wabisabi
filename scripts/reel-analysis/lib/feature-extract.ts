// Aggregate per-frame OCR detections into:
//   1. Tracks   — each token persisted across consecutive frames (temporal grouping)
//   2. Chunks   — sets of tracks active together (≈ caption groups)
//   3. Profile  — deterministic styleSpec derived from aggregate stats
//   4. CaptionPlan — ground-truth chunks (words + emphasis) reconstructed from
//                    visual evidence

import { readFileSync, writeFileSync } from 'fs';

export type Detection = {
  bbox: [number, number, number, number]; // x,y,w,h px
  text: string;
  conf: number;
  color: [number, number, number]; // r,g,b
  color_hex: string;
  font_height: number;
  font_width?: number;
  pos_x: number;
  pos_y: number;
  case: 'upper' | 'lower' | 'mixed' | 'none';
  italic?: boolean;
};

export type FrameOCR = {
  t: number;
  detections: Detection[];
};

export type FeaturesFile = {
  video_width: number;
  video_height: number;
  fps: number;
  duration_sec: number;
  sample_fps: number;
  frames: FrameOCR[];
};

export type Track = {
  id: number;
  text: string;
  start_t: number;
  end_t: number;
  samples: number;
  color: [number, number, number];
  color_hex: string;
  font_height: number;
  pos_x: number;
  pos_y: number;
  case: 'upper' | 'lower' | 'mixed' | 'none';
};

export type Chunk = {
  start_t: number;
  end_t: number;
  tracks: Track[]; // sorted top→bottom by pos_y
  lines: Track[][]; // grouped by similar pos_y
};

// ---------------------------------------------------------------------------
// Color quantization — snap an RGB tuple to a small named palette so we can
// build histograms even when OCR's k-means returns slightly different shades
// frame-to-frame.
// ---------------------------------------------------------------------------
type NamedColor = { name: string; rgb: [number, number, number] };
const NAMED_COLORS: NamedColor[] = [
  { name: 'white', rgb: [255, 255, 255] },
  { name: 'black', rgb: [0, 0, 0] },
  { name: 'red', rgb: [220, 40, 40] },
  { name: 'yellow', rgb: [240, 210, 40] },
  { name: 'green', rgb: [60, 200, 80] },
  { name: 'blue', rgb: [60, 100, 230] },
  { name: 'purple', rgb: [180, 80, 220] },
  { name: 'orange', rgb: [240, 130, 40] },
  { name: 'gray', rgb: [128, 128, 128] },
];

function colorDist(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

export function snapColor(rgb: [number, number, number]): string {
  let best = NAMED_COLORS[0]!;
  let bestDist = Infinity;
  for (const c of NAMED_COLORS) {
    const d = colorDist(rgb, c.rgb);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.name;
}

// ---------------------------------------------------------------------------
// Track building — link detections across consecutive frames if they have
// the same (case-insensitive) text AND overlapping bboxes / similar position.
// ---------------------------------------------------------------------------
function bboxOverlap(a: Detection, b: Detection): number {
  const [ax, ay, aw, ah] = a.bbox;
  const [bx, by, bw, bh] = b.bbox;
  const ix0 = Math.max(ax, bx);
  const iy0 = Math.max(ay, by);
  const ix1 = Math.min(ax + aw, bx + bw);
  const iy1 = Math.min(ay + ah, by + bh);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const inter = (ix1 - ix0) * (iy1 - iy0);
  const union = aw * ah + bw * bh - inter;
  return inter / union;
}

function normText(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Levenshtein distance — used to fuzzy-match OCR text across frames since
// EasyOCR can produce slightly different reads of the same on-screen word
// (e.g. "f*ck" → "frck", "best" stable, "BW_A" → "~W_A").
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function fuzzyEqual(a: string, b: string, maxRatio = 0.34): boolean {
  if (a === b) return true;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return true;
  const dist = editDistance(a, b);
  return dist / longer <= maxRatio;
}

function posDistance(a: Detection, b: Detection): number {
  return Math.sqrt(
    (a.pos_x - b.pos_x) ** 2 + (a.pos_y - b.pos_y) ** 2,
  );
}

export function buildTracks(features: FeaturesFile): Track[] {
  const frames = features.frames;
  if (frames.length === 0) return [];

  const tracks: Track[] = [];
  // Active tracks indexed by track id; mapped per detection-in-prev-frame
  type Active = { trackIdx: number; det: Detection };
  let active: Active[] = [];
  let nextId = 0;

  const colorBuckets: Map<number, [number, number, number][]> = new Map();
  const heightBuckets: Map<number, number[]> = new Map();
  const posBuckets: Map<number, [number, number][]> = new Map();

  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi]!;
    const matched: Active[] = [];
    const usedActive = new Set<number>();

    for (const det of f.detections) {
      // Find best match in active tracks. Match if EITHER (a) bboxes overlap
      // AND text fuzzy-matches, OR (b) positions are close AND text fuzzy-
      // matches AND font_heights are similar — the second branch handles cases
      // where OCR's bbox shifts slightly between frames.
      let bestIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < active.length; i++) {
        if (usedActive.has(i)) continue;
        const a = active[i]!;
        const aText = normText(a.det.text);
        const dText = normText(det.text);
        if (!fuzzyEqual(aText, dText, 0.34)) continue;

        const iou = bboxOverlap(a.det, det);
        const posD = posDistance(a.det, det);
        const heightRatio = Math.min(a.det.font_height, det.font_height) /
                            Math.max(a.det.font_height, det.font_height);

        let score = -1;
        if (iou > 0.2) score = iou;
        else if (posD < 0.07 && heightRatio > 0.7) score = 0.15 + heightRatio * 0.1;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const a = active[bestIdx]!;
        usedActive.add(bestIdx);
        const tr = tracks[a.trackIdx]!;
        tr.end_t = f.t;
        tr.samples += 1;
        // keep latest bbox/det for next frame matching
        matched.push({ trackIdx: a.trackIdx, det });
        // accumulate samples for averaging later
        colorBuckets.get(a.trackIdx)!.push(det.color);
        heightBuckets.get(a.trackIdx)!.push(det.font_height);
        posBuckets.get(a.trackIdx)!.push([det.pos_x, det.pos_y]);
      } else {
        // New track
        const trackIdx = tracks.length;
        const tr: Track = {
          id: nextId++,
          text: det.text,
          start_t: f.t,
          end_t: f.t,
          samples: 1,
          color: det.color,
          color_hex: det.color_hex,
          font_height: det.font_height,
          pos_x: det.pos_x,
          pos_y: det.pos_y,
          case: det.case,
        };
        tracks.push(tr);
        colorBuckets.set(trackIdx, [det.color]);
        heightBuckets.set(trackIdx, [det.font_height]);
        posBuckets.set(trackIdx, [[det.pos_x, det.pos_y]]);
        matched.push({ trackIdx, det });
      }
    }
    active = matched;
  }

  // Compute aggregated track attributes via MEDIAN — robust against
  // single-frame OCR sample blips that pull color/size means toward noise.
  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i]!;
    const colors = colorBuckets.get(i)!;
    const heights = heightBuckets.get(i)!;
    const positions = posBuckets.get(i)!;
    tr.color = [
      Math.round(median(colors.map((c) => c[0]))),
      Math.round(median(colors.map((c) => c[1]))),
      Math.round(median(colors.map((c) => c[2]))),
    ];
    tr.color_hex = `#${tr.color.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    tr.font_height = Math.round(median(heights));
    tr.pos_x = Number(median(positions.map((p) => p[0])).toFixed(4));
    tr.pos_y = Number(median(positions.map((p) => p[1])).toFixed(4));
  }

  // Filter ultra-noisy tracks. Drop:
  //   - single-sample tracks with very small font (likely OCR misreads or
  //     watermarks/UI badges in the corner of the reel)
  //   - tracks at the extreme right edge with low font_height — almost always
  //     watermarks like "BW_A" overlaid on top-right of the inner video card.
  return tracks.filter((tr) => {
    if (tr.font_height < 30) return false;
    const isTopRightCorner = tr.pos_x > 0.7 && tr.pos_y < 0.7 && tr.font_height < 110;
    if (isTopRightCorner && tr.samples <= 2) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Chunk grouping — operates directly on per-frame OCR detections instead of
// pre-built tracks. A chunk = a run of consecutive frames whose word-sets
// are similar (Jaccard >= threshold). Boundaries land where multiple words
// disappear and new ones appear at once — i.e. caption transitions.
// Track-based grouping was unreliable because dense streams of tracks at 5fps
// overlap by interval and cascade into a single mega-chunk.
// ---------------------------------------------------------------------------
function frameWordSet(f: FrameOCR): Set<string> {
  const s = new Set<string>();
  for (const d of f.detections) {
    const n = normText(d.text);
    if (n.length > 1) s.add(n);
  }
  return s;
}

function setJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 1;
}

// Fuzzy variant — counts a word in `a` as matched if any word in `b` is within
// edit-distance ratio. Handles OCR jitter between consecutive frames where the
// same on-screen word is read as "f*ck" / "frck" / "fck" etc.
function fuzzyIntersect(a: Set<string>, b: Set<string>, maxRatio = 0.34): number {
  let count = 0;
  for (const x of a) {
    for (const y of b) {
      if (fuzzyEqual(x, y, maxRatio)) { count++; break; }
    }
  }
  return count;
}

function fuzzyJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = Math.max(fuzzyIntersect(a, b), fuzzyIntersect(b, a));
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 1;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function buildChunks(tracks: Track[], features?: FeaturesFile): Chunk[] {
  // If we have per-frame data, use the Jaccard approach. Otherwise fall back
  // to the old interval grouper (mostly for tests that pass tracks alone).
  if (!features) return buildChunksFromTracks(tracks);

  const frames = features.frames;
  if (frames.length === 0) return [];

  const wordSets = frames.map(frameWordSet);
  // Find boundary indices where Jaccard(prev, cur) drops below threshold.
  // Use fuzzy comparison to absorb OCR noise (frck vs f*ck on consecutive
  // frames shouldn't trigger a boundary). Also: a boundary is only "real"
  // when the drop persists — if frame i+1 immediately recovers Jaccard with
  // i+2, treat it as OCR noise and skip.
  const JACCARD_THRESHOLD = 0.4;
  const boundaries: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    const j = fuzzyJaccard(wordSets[i - 1]!, wordSets[i]!);
    if (j < JACCARD_THRESHOLD) {
      // Single-frame dips: if frame i+1 (next) is again similar to i-1,
      // this was just an OCR blip — don't split.
      if (i + 1 < frames.length) {
        const recovery = fuzzyJaccard(wordSets[i - 1]!, wordSets[i + 1]!);
        if (recovery >= JACCARD_THRESHOLD) continue;
      }
      boundaries.push(i);
    }
  }

  // For each boundary segment, collect the union of detections, deduplicate
  // by normalized word text into per-word "mini-tracks" with averaged stats.
  const chunks: Chunk[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const startIdx = boundaries[b]!;
    const endIdx = b + 1 < boundaries.length ? boundaries[b + 1]! : frames.length;

    type Acc = {
      text: string;
      first: number;
      last: number;
      samples: Detection[];
    };
    const wordMap = new Map<string, Acc>();
    for (let i = startIdx; i < endIdx; i++) {
      const f = frames[i]!;
      for (const d of f.detections) {
        const n = normText(d.text);
        if (n.length <= 1) continue;
        // Fuzzy lookup: if any existing key is within edit-distance threshold,
        // merge into it. Handles OCR variants like "million" / "millon" /
        // "milion" of the same on-screen word.
        let key = n;
        for (const existingKey of wordMap.keys()) {
          if (fuzzyEqual(existingKey, n, 0.25)) { key = existingKey; break; }
        }
        const existing = wordMap.get(key);
        if (existing) {
          existing.last = f.t;
          existing.samples.push(d);
        } else {
          wordMap.set(key, { text: d.text, first: f.t, last: f.t, samples: [d] });
        }
      }
    }
    if (wordMap.size === 0) continue;

    const chunkTracks: Track[] = Array.from(wordMap.values()).map((w, idx) => {
      const ss = w.samples;
      // Median per-channel — robust against single-frame OCR sample blips
      // that pull mean colors toward background dark.
      const color: [number, number, number] = [
        Math.round(median(ss.map((s) => s.color[0]))),
        Math.round(median(ss.map((s) => s.color[1]))),
        Math.round(median(ss.map((s) => s.color[2]))),
      ];
      const heights = ss.map((s) => s.font_height);
      const xs = ss.map((s) => s.pos_x);
      const ys = ss.map((s) => s.pos_y);
      return {
        id: idx,
        text: w.text,
        start_t: w.first,
        end_t: w.last,
        samples: ss.length,
        color,
        color_hex: `#${color.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
        font_height: Math.round(median(heights)),
        pos_x: Number(median(xs).toFixed(4)),
        pos_y: Number(median(ys).toFixed(4)),
        case: ss[0]!.case,
      };
    }).filter((t) => t.font_height >= 30 && !(
      t.pos_x > 0.7 && t.pos_y < 0.7 && t.font_height < 110 && t.samples <= 2
    ));

    if (chunkTracks.length === 0) continue;

    chunks.push({
      start_t: frames[startIdx]!.t,
      end_t: frames[endIdx - 1]!.t,
      tracks: chunkTracks,
      lines: [],
    });
  }

  // ── MERGE PASS — coalesce adjacent chunks that share most of their words.
  // Chunk boundaries from frame-level Jaccard often over-fire because
  // captions reveal progressively (each frame adds a word, drops Jaccard
  // briefly). A real chunk transition replaces ALL words at once. So if
  // chunk N+1's tracks are >=50% CONTENT-WORD overlap with chunk N's, they're
  // the same caption continuing. We exclude filler words from this overlap
  // measure since common words like "the", "to", "of" appear across many
  // unrelated chunks and would falsely glue them together.
  const FILLERS_FOR_MERGE = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in',
    'on', 'at', 'by', 'for', 'with', 'as', 'and', 'or', 'but', 'so', 'if',
    'i', 'you', 'we', 'he', 'she', 'it', 'they', 'me', 'my', 'your',
    'this', 'that', 'these', 'those', 'thats', 'its', 'im', 'there',
  ]);
  const contentOnly = (s: string) => !FILLERS_FOR_MERGE.has(s);
  const merged: Chunk[] = [];
  for (const c of chunks) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(c);
      continue;
    }
    // Build CONTENT-only word sets for continuity comparison
    const lastWords = new Set(last.tracks.map((t) => normText(t.text)));
    const curWords = new Set(c.tracks.map((t) => normText(t.text)));
    const lastContent = new Set([...lastWords].filter(contentOnly));
    const curContent = new Set([...curWords].filter(contentOnly));
    const inter = fuzzyIntersect(lastContent, curContent);
    const minSize = Math.min(lastContent.size, curContent.size);
    const continuity = minSize > 0 ? inter / minSize : 0;
    // Also merge tiny chunks (single-track, single-frame) that share at least
    // one word with the previous chunk — those are usually OCR misses where
    // a real caption persisted but only one word came through that frame.
    const isTiny = c.tracks.length === 1 && (c.end_t - c.start_t) < 0.3;
    if (continuity >= 0.5 || (isTiny && inter > 0 && (c.start_t - last.end_t) < 0.5)) {
      // Merge: combine tracks (dedup by text).
      const trackMap = new Map<string, Track>();
      for (const t of last.tracks) trackMap.set(normText(t.text), t);
      for (const t of c.tracks) {
        const key = normText(t.text);
        const existing = trackMap.get(key);
        if (existing) {
          existing.end_t = Math.max(existing.end_t, t.end_t);
          existing.start_t = Math.min(existing.start_t, t.start_t);
          existing.samples += t.samples;
        } else {
          trackMap.set(key, t);
        }
      }
      last.tracks = Array.from(trackMap.values());
      last.end_t = Math.max(last.end_t, c.end_t);
    } else {
      merged.push(c);
    }
  }

  // Group tracks within each merged chunk into lines by pos_y.
  for (const c of merged) {
    c.tracks.sort((a, b) => a.pos_y - b.pos_y);
    const lines: Track[][] = [];
    const Y_GAP = 0.06;
    for (const tr of c.tracks) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(tr.pos_y - last[0]!.pos_y) < Y_GAP) {
        last.push(tr);
      } else {
        lines.push([tr]);
      }
    }
    for (const line of lines) line.sort((a, b) => a.pos_x - b.pos_x);
    c.lines = lines;
  }

  return merged;
}

// Legacy interval-based grouper — kept as fallback for callers without
// per-frame data. The Jaccard-based grouper above is preferred.
function buildChunksFromTracks(tracks: Track[]): Chunk[] {
  const sorted = [...tracks].sort((a, b) => a.start_t - b.start_t);
  const chunks: Chunk[] = [];
  for (const tr of sorted) {
    let placed = false;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]!;
      if (tr.start_t <= c.end_t + 0.4) {
        c.tracks.push(tr);
        c.start_t = Math.min(c.start_t, tr.start_t);
        c.end_t = Math.max(c.end_t, tr.end_t);
        placed = true;
        break;
      }
    }
    if (!placed) {
      chunks.push({ start_t: tr.start_t, end_t: tr.end_t, tracks: [tr], lines: [] });
    }
  }
  for (const c of chunks) {
    c.tracks.sort((a, b) => a.pos_y - b.pos_y);
    const lines: Track[][] = [];
    const Y_GAP = 0.06;
    for (const tr of c.tracks) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(tr.pos_y - last[0]!.pos_y) < Y_GAP) last.push(tr);
      else lines.push([tr]);
    }
    for (const line of lines) line.sort((a, b) => a.pos_x - b.pos_x);
    c.lines = lines;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Style profile — aggregate stats over chunks/tracks → deterministic styleSpec.
// ---------------------------------------------------------------------------
export type StyleProfile = {
  chunks_total: number;
  tracks_total: number;
  duration_sec: number;
  // Color usage counts (snapped to named palette)
  colors: Record<string, number>;
  dominant_color: string;
  emphasis_colors: string[]; // non-dominant colors with usage > threshold
  // Size tiers
  font_heights: { p25: number; p50: number; p75: number; p95: number };
  cascade_detected: boolean;
  cascade_top_ratio: number; // p25 / p95
  // Case usage on emphasis-color words
  emphasis_case: Record<string, number>;
  // Position
  pos_y_dominant: number; // median
  pos_y_band: 'top' | 'middle' | 'bottom';
  // Reveal mode — do tracks within a chunk start at distinct times?
  progressive_reveal_score: number; // 0..1, higher = more progressive
  // Words rendered in italic-like style — detected via shear-angle analysis
  // in the OCR sidecar. Populated automatically when the source has italic
  // accent words. Kept for inspection/debugging; the preset-level italic
  // signal is `italic_rate` below (a generic style attribute, not a vocab
  // list — the latter is reel-specific and doesn't transfer to new videos).
  italic_words: string[];
  // Fraction of detected content-emphasis-style words that came back italic.
  // 0 = no italic, 0.05 = ~5% of emphasis words are italic accents, 1 = all.
  // This is the *style rate* the renderer applies at any input video,
  // independent of the reference reel's specific vocabulary.
  italic_rate: number;
  // Words tagged as emphasis, used as italic vocabulary candidates
  emphasis_word_samples: { text: string; color: string; case: string }[];
  // Empirical typography measurements for downstream styleSpec sizing.
  // anchor_width_pct: median (anchor word bbox width / frame width) for
  //   top-quartile-height tracks. Drives emphasisFillRatio.
  // char_advance: median (bbox_width / (text_length * font_height)) across
  //   all detections. Equivalent to the CHAR_ADVANCE constant the renderer
  //   uses to translate font-size to expected glyph-width.
  anchor_width_pct: number;
  char_advance: number;
};

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}

export function buildProfile(
  features: FeaturesFile,
  tracks: Track[],
  chunks: Chunk[],
): StyleProfile {
  const colorCounts: Record<string, number> = {};
  const heights: number[] = [];
  const positions: number[] = [];
  const caseCounts: Record<string, number> = {};

  for (const tr of tracks) {
    const name = snapColor(tr.color);
    colorCounts[name] = (colorCounts[name] ?? 0) + tr.samples;
    heights.push(tr.font_height);
    positions.push(tr.pos_y);
  }

  // Dominant color = most frequent (excluding black/gray which are usually
  // outline, watermark, or low-saturation noise from OCR color sampling).
  const colorEntries = Object.entries(colorCounts)
    .filter(([n]) => n !== 'black' && n !== 'gray')
    .sort((a, b) => b[1] - a[1]);
  const dominantColor = colorEntries[0]?.[0] ?? 'white';

  // Emphasis colors = saturated non-dominant colors meeting an absolute
  // count threshold. Dominance-relative thresholds suppress real emphasis
  // colors when the dominant count is huge (e.g. white:355 vs red:10 — red
  // is real but only 2.8% of dominant). Use an absolute floor instead.
  // Floor of 5 catches genuine emphasis usage while filtering OCR noise
  // (single-frame misreads usually bucket into 1-2 detections).
  const emphasisColors = colorEntries
    .slice(1)
    .filter(([, c]) => c >= 5)
    .map(([n]) => n);

  // Per-emphasis-color, accumulate case usage on those tracks
  const emphasisWordSamples: StyleProfile['emphasis_word_samples'] = [];
  for (const tr of tracks) {
    const name = snapColor(tr.color);
    if (name === dominantColor || name === 'black') continue;
    caseCounts[tr.case] = (caseCounts[tr.case] ?? 0) + 1;
    emphasisWordSamples.push({ text: tr.text, color: name, case: tr.case });
  }

  // Cascade detection — compute per-frame instead of per-chunk to avoid
  // depending on chunk grouping (which is brittle at high OCR fps). For each
  // frame with 2+ detections at different y-bands, compare top-line font
  // height to bottom-line font height. Aggregate across frames.
  let cascadeFrames = 0;
  let cascadeWith = 0;
  const cascadeRatios: number[] = [];
  for (const f of features.frames) {
    if (f.detections.length < 2) continue;
    // Group by approximate y-band
    const sorted = [...f.detections].sort((a, b) => a.pos_y - b.pos_y);
    const lines: typeof sorted[] = [];
    const Y_GAP = 0.06;
    for (const d of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(d.pos_y - last[0]!.pos_y) < Y_GAP) {
        last.push(d);
      } else {
        lines.push([d]);
      }
    }
    if (lines.length < 2) continue;
    cascadeFrames++;
    const topAvg = lines[0]!.reduce((s, d) => s + d.font_height, 0) / lines[0]!.length;
    const botAvg = lines[lines.length - 1]!.reduce((s, d) => s + d.font_height, 0) / lines[lines.length - 1]!.length;
    if (botAvg > topAvg * 1.15) {
      cascadeWith++;
      cascadeRatios.push(topAvg / botAvg);
    }
  }
  const cascadeDetected = cascadeFrames > 0 && cascadeWith / cascadeFrames > 0.3;
  const cascadeTopRatio = cascadeRatios.length
    ? cascadeRatios.reduce((a, b) => a + b, 0) / cascadeRatios.length
    : 1.0;

  // Position band — bias toward 'bottom' since the test reel has
  // letterboxing that shifts the content area's center to ~0.5–0.6.
  // We look at the LOWER quartile of y-positions; if even that's > 0.5,
  // captions are mostly in the lower half → 'bottom'. Same for top.
  const medY = quantile(positions, 0.5);
  const lowerQ = quantile(positions, 0.25);
  const upperQ = quantile(positions, 0.75);
  const posBand: 'top' | 'middle' | 'bottom' =
    upperQ < 0.45 ? 'top'
    : lowerQ > 0.55 ? 'bottom'
    : 'middle';

  // Reveal mode: within chunks with multiple tracks, are the start_t values
  // spread out, or all bunched at the same time?
  let revealSpread = 0;
  let revealCount = 0;
  for (const c of chunks) {
    if (c.tracks.length < 2) continue;
    const starts = c.tracks.map((t) => t.start_t);
    const spread = Math.max(...starts) - Math.min(...starts);
    const duration = Math.max(0.001, c.end_t - c.start_t);
    revealSpread += spread / duration;
    revealCount++;
  }
  const progressiveScore = revealCount > 0 ? revealSpread / revealCount : 0;

  // ── Italic detection: aggregate per-detection `italic: true` flags from
  // the OCR sidecar with fuzzy-merge across OCR text variants. The shear-
  // angle test in Python is per-detection — same on-screen word may be OCR'd
  // as "raresonable" / "retesonable" / "ratesonable" across consecutive
  // frames, all flagged italic. Without fuzzy merge each variant has
  // count=1 and gets rejected by the threshold.
  type ItalicAcc = {
    canonical: string;
    italic: number;
    total: number;
    minHeight: number;
    samples: string[];
  };
  const italicAccs: ItalicAcc[] = [];
  for (const f of features.frames) {
    for (const d of f.detections) {
      const k = normText(d.text);
      if (k.length < 2) continue;
      // Find an existing accumulator whose canonical key fuzzy-matches.
      let acc = italicAccs.find((a) => fuzzyEqual(a.canonical, k, 0.34));
      if (!acc) {
        acc = { canonical: k, italic: 0, total: 0, minHeight: d.font_height, samples: [] };
        italicAccs.push(acc);
      }
      acc.total++;
      acc.minHeight = Math.min(acc.minHeight, d.font_height);
      if (d.italic) {
        acc.italic++;
        if (acc.samples.length < 5) acc.samples.push(d.text);
      }
    }
  }
  // Filters to suppress shear-test false positives:
  //   - min alpha length 5 — short words like "you"/"yes"/"way" trigger the
  //     detector via naturally slanted Y/V/W strokes
  //   - min 3 italic detections — single-frame blips can read as italic
  //   - italic rate >= 60% — word must consistently read italic
  //   - min font_height 60 — small text gives unreliable shear measurements
  const italicWords: string[] = [];
  let italicQualifyingWords = 0;
  let totalQualifyingWords = 0;
  for (const a of italicAccs) {
    const alphaLen = a.canonical.replace(/[^a-z]/g, '').length;
    // Track italic rate denominator: words long enough that the shear test
    // is reliable. This is the universe over which we measure italic prevalence.
    if (alphaLen < 5) continue;
    if (a.total < 3) continue;
    if (a.minHeight < 60) continue;
    totalQualifyingWords++;
    if (a.italic / a.total >= 0.6 && a.italic >= 3) {
      italicQualifyingWords++;
      italicWords.push(a.canonical);
    }
  }
  const italicRate = totalQualifyingWords > 0
    ? Number((italicQualifyingWords / totalQualifyingWords).toFixed(3))
    : 0;

  // ── Empirical typography measurements
  // anchor_width_pct: among top-quartile-height detections (the anchor tier),
  // what fraction of frame width does an average word occupy?
  const heightP75 = quantile(heights, 0.75);
  const anchorWidthPcts: number[] = [];
  const charAdvances: number[] = [];
  for (const f of features.frames) {
    for (const d of f.detections) {
      const wpx = d.font_width ?? d.bbox[2];
      const hpx = d.font_height;
      const textLen = d.text.replace(/\s/g, '').length;
      if (textLen === 0 || hpx <= 0 || wpx <= 0) continue;
      // char-advance ratio = char-width / glyph-height
      charAdvances.push(wpx / (textLen * hpx));
      // anchor candidate: top-quartile height
      if (hpx >= heightP75) {
        anchorWidthPcts.push(wpx / features.video_width);
      }
    }
  }
  const anchorWidthPct = anchorWidthPcts.length > 0
    ? Number(quantile(anchorWidthPcts, 0.75).toFixed(3))  // upper-quartile of anchor-tier widths
    : 0;
  const charAdvance = charAdvances.length > 0
    ? Number(quantile(charAdvances, 0.5).toFixed(3))
    : 0.58;

  return {
    chunks_total: chunks.length,
    tracks_total: tracks.length,
    duration_sec: features.duration_sec,
    colors: colorCounts,
    dominant_color: dominantColor,
    emphasis_colors: emphasisColors,
    font_heights: {
      p25: Math.round(quantile(heights, 0.25)),
      p50: Math.round(quantile(heights, 0.5)),
      p75: Math.round(quantile(heights, 0.75)),
      p95: Math.round(quantile(heights, 0.95)),
    },
    cascade_detected: cascadeDetected,
    cascade_top_ratio: Number(cascadeTopRatio.toFixed(2)),
    emphasis_case: caseCounts,
    pos_y_dominant: Number(medY.toFixed(3)),
    pos_y_band: posBand,
    progressive_reveal_score: Number(progressiveScore.toFixed(3)),
    italic_words: italicWords,
    italic_rate: italicRate,
    emphasis_word_samples: emphasisWordSamples.slice(0, 30),
    anchor_width_pct: anchorWidthPct,
    char_advance: charAdvance,
  };
}

// ---------------------------------------------------------------------------
// Build a ground-truth captionPlan from chunks. Each track becomes a "word"
// with timing taken from the track. Emphasis flag = true if the track's color
// is not the dominant color.
// ---------------------------------------------------------------------------
export function buildGroundTruthPlan(
  chunks: Chunk[],
  dominantColor: string,
): { chunks: { words: any[]; emphasis: boolean[] }[] } {
  const out: { chunks: { words: any[]; emphasis: boolean[] }[] } = { chunks: [] };
  for (const c of chunks) {
    // Flatten line-by-line, top→bottom, left→right
    const flat: Track[] = [];
    for (const line of c.lines) flat.push(...line);
    if (flat.length === 0) continue;
    const words = flat.map((tr) => ({
      word: tr.text,
      start: tr.start_t,
      end: tr.end_t,
      confidence: 1.0,
      color_hex: tr.color_hex,
      color_name: snapColor(tr.color),
      pos_y: tr.pos_y,
      font_height: tr.font_height,
      case: tr.case,
    }));
    const emphasis = flat.map((tr) => snapColor(tr.color) !== dominantColor);
    out.chunks.push({ words, emphasis });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry — reads features.json, writes profile.json + captionPlan.gt.json
// ---------------------------------------------------------------------------
export function processFeatures(featuresPath: string, outDir: string): {
  tracks: Track[]; chunks: Chunk[]; profile: StyleProfile;
} {
  const features: FeaturesFile = JSON.parse(readFileSync(featuresPath, 'utf-8'));
  const tracks = buildTracks(features);
  const chunks = buildChunks(tracks, features);
  const profile = buildProfile(features, tracks, chunks);
  const plan = buildGroundTruthPlan(chunks, profile.dominant_color);
  writeFileSync(`${outDir}/tracks.json`, JSON.stringify(tracks, null, 2));
  writeFileSync(`${outDir}/style-profile.json`, JSON.stringify(profile, null, 2));
  writeFileSync(`${outDir}/captionPlan.gt.json`, JSON.stringify(plan, null, 2));
  return { tracks, chunks, profile };
}
