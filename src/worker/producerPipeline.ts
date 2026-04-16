import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { db } from '../db.js';
import {
  analyzeImageAsset,
  analyzeVideoAsset,
  type AnalyzedAsset,
} from '../stages/analyzeAsset.js';
import { detectMode } from '../stages/detectMode.js';
import { produceTimeline } from '../stages/produceTimeline.js';
import { cutSegments } from '../stages/cutSegments.js';
import { narrate } from '../stages/narrate.js';
import { enrichTranscript } from '../stages/enrichTranscript.js';
import { pickHook } from '../stages/pickHook.js';
import { renderProduction } from '../stages/renderProduction.js';
import { ffprobe } from '../stages/ffprobe.js';
import { pickRandomBrainRotClip } from '../shared/brainRotPool.js';
import type {
  AssetAnalysis,
  CutTimelineEntry,
  Diarization,
  ProductionAsset,
  ProductionMode,
  ProductionPlan,
  ProductionRow,
} from '../shared/productionTypes.js';
import type { CaptionPlan, FaceData, Transcript, Word } from '../shared/types.js';
import type { StyleSpec } from '../shared/styleSpec.js';
import { NARRATED_STORY_DEFAULT_PRESETS, PRESETS } from '../shared/presets.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

// Prepared statements — same pattern as the single-video pipeline.
const selectProduction = db.prepare(`select * from productions where id = ?`);
const selectAssets = db.prepare(
  `select * from production_assets where productionId = ? order by ordinal asc`,
);
const setStageStmt = db.prepare(
  `update productions set stage = ?, updatedAt = datetime('now') where id = ?`,
);
const setModeStmt = db.prepare(
  `update productions set mode = ?, updatedAt = datetime('now') where id = ?`,
);
const setPlanStmt = db.prepare(
  `update productions set productionPlan = ?, updatedAt = datetime('now') where id = ?`,
);
const setTimelineStmt = db.prepare(
  `update productions set timeline = ?, updatedAt = datetime('now') where id = ?`,
);
const setNarrationStmt = db.prepare(
  `update productions
     set narrationPath = ?, narrationScript = ?, updatedAt = datetime('now')
   where id = ?`,
);
const setStyleSpecStmt = db.prepare(
  `update productions set styleSpec = ?, updatedAt = datetime('now') where id = ?`,
);
const setOutputPathStmt = db.prepare(
  `update productions set outputPath = ?, updatedAt = datetime('now') where id = ?`,
);
const setHookFileStmt = db.prepare(
  `update productions set hookFile = ?, updatedAt = datetime('now') where id = ?`,
);
const setProgressStmt = db.prepare(
  `update productions set progress = ?, updatedAt = datetime('now') where id = ?`,
);

const updateAssetAnalysisStmt = db.prepare(`
  update production_assets
     set durationSec = @durationSec,
         width = @width,
         height = @height,
         transcript = @transcript,
         diarization = @diarization,
         faces = @faces,
         analysis = @analysis,
         hasSpeech = @hasSpeech,
         speakerCoverage = @speakerCoverage,
         role = @role,
         error = @error
   where id = @id
`);

type AssetRow = {
  id: string;
  productionId: string;
  ordinal: number;
  kind: 'video' | 'image';
  path: string;
  mime: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  transcript: string | null;
  diarization: string | null;
  faces: string | null;
  analysis: string | null;
  hasSpeech: number;
  speakerCoverage: number | null;
  role: string | null;
  error: string | null;
};

type ProductionDbRow = {
  id: string;
  capSeconds: number;
  prompt: string | null;
  presetId: string | null;
  voiceId: string | null;
  styleSpec: string;
  templateId: string;
  userId: string | null;
};

function setStage(prodId: string, stage: string): void {
  console.log(`[prod ${prodId}] -> ${stage}`);
  setStageStmt.run(stage, prodId);
}

function hydrateAssetRow(row: AssetRow): ProductionAsset {
  const parse = <T,>(v: string | null): T | null => {
    if (!v) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  };
  return {
    id: row.id,
    productionId: row.productionId,
    ordinal: row.ordinal,
    kind: row.kind,
    path: row.path,
    mime: row.mime,
    durationSec: row.durationSec,
    width: row.width,
    height: row.height,
    transcript: parse<Transcript>(row.transcript),
    diarization: parse<Diarization>(row.diarization),
    faces: parse<FaceData>(row.faces),
    analysis: parse<AssetAnalysis>(row.analysis),
    hasSpeech: !!row.hasSpeech,
    speakerCoverage: row.speakerCoverage,
    role: (row.role as ProductionAsset['role']) ?? null,
    error: row.error,
  };
}

// Rebase a transcript's word times into the cut clip's local timeline. The
// CaptionLayer inside a Series.Sequence uses `useCurrentFrame()` which is
// zero at the sequence start — so the words it consumes must be expressed
// in 0..cutDurationSec too.
function rebaseTranscript(
  transcript: Transcript | null,
  inSec: number,
  cutDurationSec: number,
): Transcript | null {
  if (!transcript) return null;
  const rebased: Word[] = [];
  for (const w of transcript.words) {
    const start = w.start - inSec;
    const end = w.end - inSec;
    if (end <= 0) continue;
    if (start >= cutDurationSec) break;
    rebased.push({
      word: w.word,
      start: Math.max(0, start),
      end: Math.min(cutDurationSec, end),
      confidence: w.confidence,
    });
  }
  return {
    language: transcript.language,
    duration: cutDurationSec,
    words: rebased,
  };
}

// Pick a vibrant caption preset for narrated_story when the user didn't
// specify one. Deterministic from the production id so re-running with the
// same id picks the same look; different productions rotate through the
// available looks so consecutive uploads feel visually distinct.
function pickStoryPreset(prodId: string): StyleSpec {
  const presets = NARRATED_STORY_DEFAULT_PRESETS;
  // Simple sum-of-charcodes hash — the list is tiny, no need for SHA.
  let hash = 0;
  for (let i = 0; i < prodId.length; i++) hash = (hash + prodId.charCodeAt(i)) | 0;
  const chosen = presets[Math.abs(hash) % presets.length] ?? presets[0]!;
  console.log(`pickStoryPreset: ${chosen} (hash-selected from ${presets.length})`);
  return PRESETS[chosen]!.styleSpec as StyleSpec;
}

// Hopecore chunk rotation: varies position, animation, font size, and
// wrapping across the LLM-made caption chunks so the captions feel alive
// — moving through the frame in rhythm with the narration, occasionally
// hitting hero-sized emotional beats in the middle of the screen.
//
// Each entry describes one "moment type". The rotation is sampled
// modulo chunkCount; the starting offset is seeded from the production
// id so different videos don't all start on the same beat.
type HopecoreMoment = {
  position: 'top' | 'middle' | 'bottom';
  preset: 'pop' | 'slide' | 'fade' | 'karaoke' | 'typewriter';
  sizeMul: number; // multiplier on base font.size
  maxWords: number;
  durationMs: number;
  letterSpacing?: number;
};

const HOPECORE_ROTATION: HopecoreMoment[] = [
  { position: 'bottom', preset: 'pop',        sizeMul: 1.00, maxWords: 5, durationMs: 150 },
  { position: 'middle', preset: 'slide',      sizeMul: 1.18, maxWords: 3, durationMs: 200, letterSpacing: 2 }, // hero
  { position: 'top',    preset: 'fade',       sizeMul: 1.00, maxWords: 4, durationMs: 220 },
  { position: 'bottom', preset: 'karaoke',    sizeMul: 1.00, maxWords: 5, durationMs: 160 },
  { position: 'middle', preset: 'pop',        sizeMul: 1.25, maxWords: 3, durationMs: 160, letterSpacing: 3 }, // big hero
  { position: 'top',    preset: 'slide',      sizeMul: 1.05, maxWords: 4, durationMs: 200 },
  { position: 'bottom', preset: 'typewriter', sizeMul: 1.00, maxWords: 5, durationMs: 150 },
  { position: 'middle', preset: 'fade',       sizeMul: 1.10, maxWords: 4, durationMs: 220, letterSpacing: 1 },
];

function buildHopecoreChunkOverrides(
  chunkCount: number,
  baseFontSize: number,
  seed: string,
): Array<{ range: [number, number]; overrides: Record<string, unknown> }> {
  // Seed the starting beat so consecutive productions don't all open with
  // the same caption moment. Simple sum-of-charcodes — good enough.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) | 0;
  const offset = Math.abs(hash) % HOPECORE_ROTATION.length;

  const out: Array<{ range: [number, number]; overrides: Record<string, unknown> }> = [];
  for (let i = 0; i < chunkCount; i++) {
    const m = HOPECORE_ROTATION[(i + offset) % HOPECORE_ROTATION.length]!;
    const fontOverride: Record<string, unknown> = {
      size: Math.round(baseFontSize * m.sizeMul),
    };
    if (m.letterSpacing !== undefined) fontOverride.letterSpacing = m.letterSpacing;
    out.push({
      range: [i, i],
      overrides: {
        layout: {
          position: m.position,
          maxWordsPerLine: m.maxWords,
          // Safer margins on top/middle so text doesn't clip on taller
          // UI overlays (status bars in the preview, etc).
          safeMargin: m.position === 'top' ? 0.08 : m.position === 'middle' ? 0.1 : 0.1,
        },
        font: fontOverride,
        animation: { preset: m.preset, durationMs: m.durationMs },
      },
    });
  }
  return out;
}

// Core pipeline entry point. Runs every stage in sequence; each writes its
// own durable state to the DB so a crash mid-pipeline leaves us with the
// partial results.
export async function runProductionPipeline(prodId: string): Promise<void> {
  const row = selectProduction.get(prodId) as ProductionDbRow | undefined;
  if (!row) throw new Error(`production ${prodId} not found`);

  let styleSpec = JSON.parse(row.styleSpec) as StyleSpec;
  const capSeconds = row.capSeconds;
  const workDir = join(STORAGE_DIR, 'productions', prodId, 'work');
  await mkdir(workDir, { recursive: true });

  // STAGE 1: analyze every asset. Fan out per-asset so a slow video doesn't
  // block a fast image.
  setStage(prodId, 'analyze_assets');
  const assetRows = selectAssets.all(prodId) as AssetRow[];
  if (assetRows.length === 0) throw new Error('production has no assets');

  await Promise.all(
    assetRows.map(async (raw) => {
      const assetWorkDir = join(workDir, 'assets', raw.id);
      try {
        const asset = hydrateAssetRow(raw);
        const result: AnalyzedAsset =
          asset.kind === 'video'
            ? await analyzeVideoAsset(asset, assetWorkDir)
            : await analyzeImageAsset(asset);
        updateAssetAnalysisStmt.run({
          id: raw.id,
          durationSec: result.durationSec,
          width: result.width,
          height: result.height,
          transcript: result.transcript ? JSON.stringify(result.transcript) : null,
          diarization: result.diarization ? JSON.stringify(result.diarization) : null,
          faces: result.faces ? JSON.stringify(result.faces) : null,
          analysis: result.analysis ? JSON.stringify(result.analysis) : null,
          hasSpeech: result.hasSpeech ? 1 : 0,
          speakerCoverage: result.speakerCoverage,
          role: null, // set after mode detection
          error: null,
        });
        console.log(
          `[prod ${prodId}] asset ${raw.ordinal} (${raw.kind}) done — hasSpeech=${result.hasSpeech} words=${result.transcript?.words.length ?? 0}`,
        );
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(`[prod ${prodId}] asset ${raw.ordinal} failed:`, msg);
        updateAssetAnalysisStmt.run({
          id: raw.id,
          durationSec: 0,
          width: null,
          height: null,
          transcript: null,
          diarization: null,
          faces: null,
          analysis: null,
          hasSpeech: 0,
          speakerCoverage: null,
          role: null,
          error: msg,
        });
      }
    }),
  );

  // Re-read assets with their freshly populated analysis fields.
  const freshRows = selectAssets.all(prodId) as AssetRow[];
  const assets = freshRows
    .filter((r) => !r.error)
    .map(hydrateAssetRow);
  if (assets.length === 0) {
    throw new Error('all assets failed analysis — nothing to produce');
  }

  // STAGE 2: detect mode.
  setStage(prodId, 'detect_mode');
  const decision = detectMode(assets);
  console.log(
    `[prod ${prodId}] mode: ${decision.mode} (${decision.reason})`,
  );
  setModeStmt.run(decision.mode, prodId);

  // STAGE 3: orchestrator LLM -> timeline plan. The optional user prompt
  // gives the orchestrator creative direction (e.g. "this story is about a
  // tech city based on network school"). Mode is already locked from the
  // deterministic detector — the prompt influences ordering, narration,
  // and tone within that mode.
  setStage(prodId, 'orchestrate');
  if (row.prompt) {
    console.log(`[prod ${prodId}] user brief: ${row.prompt.slice(0, 160)}`);
  }
  const plan: ProductionPlan = await produceTimeline({
    mode: decision.mode,
    capSeconds,
    assets,
    userBrief: row.prompt,
  });
  setPlanStmt.run(JSON.stringify(plan), prodId);

  // Mark each referenced asset with its final role so the UI + DB reflect
  // the producer's choices.
  const assignRoleStmt = db.prepare(
    `update production_assets set role = ? where id = ?`,
  );
  for (const entry of plan.timeline) {
    assignRoleStmt.run(entry.role, entry.assetId);
  }

  // STAGE 4: cut segments. Produces the per-entry mp4s the renderer stages.
  setStage(prodId, 'cut_segments');
  let cuts = await cutSegments({
    timeline: plan.timeline,
    assets,
    workDir,
  });

  // STAGE 5: narration (narrated_story only). Real TTS mp3 durations may
  // diverge from the LLM's estimates — when that happens we also adjust
  // each broll/image clip to match its assigned beat's real duration, then
  // re-cut the corresponding video entries.
  let narrationPath: string | null = null;
  let narrationBeats = plan.narrationScript ?? null;
  let narrationTranscript: Transcript | null = null;
  if (plan.mode === 'narrated_story' && plan.narrationScript && plan.narrationScript.length > 0) {
    setStage(prodId, 'narrate');
    const narrateResult = await narrate({
      beats: plan.narrationScript,
      voiceId: row.voiceId,
      workDir,
    });
    narrationPath = narrateResult.narrationPath;
    narrationBeats = narrateResult.beats;
    narrationTranscript = narrateResult.transcript;
    setNarrationStmt.run(
      narrationPath,
      JSON.stringify(narrationBeats),
      prodId,
    );

    // Re-cut any clips whose assigned beat duration changed. Only re-cut
    // videos — images don't need ffmpeg and their cutDurationSec is just a
    // marker the renderer uses for the Series.Sequence duration.
    const updatedTimeline = plan.timeline.map((entry) => {
      if (entry.narrationIndex === undefined) return entry;
      const beat = narrationBeats?.[entry.narrationIndex];
      if (!beat) return entry;
      const wantDur = Math.max(0.2, beat.endSec - beat.startSec);
      const currentDur = entry.outSec - entry.inSec;
      if (Math.abs(currentDur - wantDur) < 0.1) return entry;
      return {
        ...entry,
        outSec: entry.inSec + wantDur,
      };
    });
    if (updatedTimeline.some((e, i) => e.outSec !== plan.timeline[i]!.outSec)) {
      console.log(`[prod ${prodId}] re-cutting after narration timing adjustment`);
      cuts = await cutSegments({
        timeline: updatedTimeline,
        assets,
        workDir,
      });
    }
  }

  // Attach per-clip transcript/captionPlan/faces for speaker clips, rebased
  // to clip-local time. The renderer forwards these to <CaptionLayer>.
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const enrichedCuts: CutTimelineEntry[] = [];
  for (const entry of cuts) {
    if (entry.role !== 'speaker') {
      enrichedCuts.push(entry);
      continue;
    }
    const asset = assetsById.get(entry.assetId);
    const rebased = rebaseTranscript(
      asset?.transcript ?? null,
      entry.inSec,
      entry.cutDurationSec,
    );
    // Re-run enrichment over the rebased word list so chunk boundaries are
    // computed over only the retained words. Graceful null fallback — the
    // CaptionLayer falls back to fixed-N chunking if captionPlan is null.
    const captionPlan =
      rebased && rebased.words.length > 0 ? await enrichTranscript(rebased) : null;
    enrichedCuts.push({
      ...entry,
      transcript: rebased,
      captionPlan,
      faces: asset?.faces ?? null,
    });
  }

  // STAGE 5.5: pick an engagement hook and prepend it to the timeline. The
  // hook plays with its native audio; narration starts AFTER the hook ends
  // (we shift narration word times and the <Audio> start frame below).
  // Failures here are non-fatal — we just skip prepending.
  setStage(prodId, 'pick_hook');
  const hook = await pickHook({ userId: row.userId ?? null, prodId });
  let hookDurSec = 0;
  if (hook) {
    setHookFileStmt.run(hook.file, prodId);
    hookDurSec = hook.durationSec;
    // Shift every narration-side timebase by hookDurSec so words and beats
    // remain aligned to the actual audio after the hook's delay. The
    // StoryComposition wraps narration <Audio> in <Sequence from=hookFrames>
    // so the audio file itself stays untouched on disk.
    if (narrationTranscript) {
      narrationTranscript = {
        ...narrationTranscript,
        duration: narrationTranscript.duration + hookDurSec,
        words: narrationTranscript.words.map((w) => ({
          ...w,
          start: w.start + hookDurSec,
          end: w.end + hookDurSec,
        })),
      };
    }
    if (narrationBeats) {
      narrationBeats = narrationBeats.map((b) => ({
        ...b,
        startSec: b.startSec + hookDurSec,
        endSec: b.endSec + hookDurSec,
      }));
    }
    // Synthetic timeline entry. assetId '__hook__' is a sentinel — no asset
    // row exists. Role 'broll' keeps the CaptionLayer off; keepAudio=true
    // plays the hook's own sound design. narrationIndex intentionally unset
    // so the renderer doesn't try to fetch a title-card caption.
    enrichedCuts.unshift({
      assetId: '__hook__',
      role: 'broll',
      inSec: 0,
      outSec: hookDurSec,
      keepAudio: true,
      cutPath: hook.path,
      cutDurationSec: hookDurSec,
      transcript: null,
      captionPlan: null,
      faces: null,
    });
    console.log(
      `[prod ${prodId}] hook prepended: ${hook.file} (${hookDurSec.toFixed(2)}s)`,
    );
  }

  setTimelineStmt.run(JSON.stringify(enrichedCuts), prodId);

  // Enrich the narration transcript for PopWords-style captions over the
  // whole rendered video. The transcript's word times are already in the
  // global output-timeline, so the CaptionLayer placed outside <Series>
  // in StoryComposition activates chunks at the right frames.
  let narrationCaptionPlan: CaptionPlan | null = null;
  if (narrationTranscript && narrationTranscript.words.length > 0) {
    narrationCaptionPlan = await enrichTranscript(narrationTranscript);
    console.log(
      `[prod ${prodId}] narration captions: ${narrationTranscript.words.length} words -> ${narrationCaptionPlan?.chunks.length ?? 'fallback'} chunks`,
    );
  }

  // Apply a vibrant story preset + per-chunk animation rotation when the
  // user didn't pick a preset. Since the user expressed no preference
  // (no presetId passed), we REPLACE styleSpec rather than merge — a
  // merge would let Zod-defaulted values (plain white fill, yellow
  // emphasis) clobber the preset's palette and layout. Explicit preset
  // choice is handled up-front in the API (merges user styleSpec on top
  // of the preset there).
  if (plan.mode === 'narrated_story') {
    if (!row.presetId) {
      const storyBase = pickStoryPreset(prodId);
      styleSpec = storyBase;
    }
    // Rotate animation presets across chunks so no two consecutive
    // captions pop in the same way. When enrichTranscript succeeds we know
    // the exact chunk count; when it fails, estimate it from the fallback
    // chunker formula (ceil(words / maxWordsPerLine)) so rotation still
    // applies even on LLM hiccups.
    const maxWordsPerLine =
      (styleSpec as { layout?: { maxWordsPerLine?: number } }).layout?.maxWordsPerLine ?? 4;
    const estimatedChunks =
      narrationCaptionPlan?.chunks.length ??
      (narrationTranscript
        ? Math.ceil(narrationTranscript.words.length / maxWordsPerLine)
        : 0);
    // Classic CaptionLayer benefits from per-chunk position/size rotation.
    // Editorial mode renders with HopecoreCaptionLayer which handles its
    // own per-chunk variation (rotation angle, palette cycling, per-word
    // size tiers), so skip generating overrides there.
    const isEditorial =
      (styleSpec as { layout?: { mode?: string } }).layout?.mode === 'editorial';
    if (estimatedChunks > 0 && !isEditorial) {
      const userOverrides =
        (styleSpec as { chunkOverrides?: Array<{ range: [number, number]; overrides: Record<string, unknown> }> })
          .chunkOverrides ?? [];
      const baseFontSize =
        (styleSpec as { font?: { size?: number } }).font?.size ?? 62;
      const generated = buildHopecoreChunkOverrides(estimatedChunks, baseFontSize, prodId);
      (styleSpec as Record<string, unknown>).chunkOverrides = [
        ...generated,
        ...userOverrides, // user overrides applied AFTER generated → user wins
      ];
      console.log(
        `[prod ${prodId}] hopecore rotation: ${estimatedChunks} chunks (${narrationCaptionPlan ? 'from LLM plan' : 'estimated from fallback chunker'}), baseFont=${baseFontSize}`,
      );
    } else if (isEditorial) {
      console.log(`[prod ${prodId}] editorial caption layer — per-chunk rotation handled in-component`);
    }

    // Persist the post-merge styleSpec so GET /productions/:id reflects
    // what was actually rendered, not what the user submitted.
    setStyleSpecStmt.run(JSON.stringify(styleSpec), prodId);
  }

  // STAGE 6: render.
  setStage(prodId, 'compose_render');
  // Lambda mode skips local disk entirely — the mkdir is cheap and harmless
  // (keeps the local branch happy) but the dir stays empty for lambda renders.
  const outputDir = join(STORAGE_DIR, 'productions', prodId, 'output');
  await mkdir(outputDir, { recursive: true });
  const hintedOutputPath = join(outputDir, `${prodId}.mp4`);

  // Brain-rot split: pick one random clip per production (deterministic by
  // prodId so reprocess reaches for the same file) and ffprobe it so the
  // composition can Loop it across the whole output. Empty/missing library
  // folder is a warning, not a hard error — the render proceeds full-frame.
  let brainRotClipPath: string | null = null;
  let brainRotDurationSec: number | null = null;
  const splitSpec = (styleSpec as { splitScreen?: { brainRot?: boolean } }).splitScreen;
  if (splitSpec?.brainRot) {
    brainRotClipPath = await pickRandomBrainRotClip(prodId);
    if (brainRotClipPath) {
      brainRotDurationSec = (await ffprobe(brainRotClipPath)).duration;
      console.log(
        `[prod ${prodId}] brain-rot split enabled; clip=${basename(brainRotClipPath)} dur=${brainRotDurationSec.toFixed(2)}s`,
      );
    } else {
      console.warn(
        `[prod ${prodId}] splitScreen.brainRot=true but /storage/brain-rot/ is empty or missing — skipping effect`,
      );
    }
  }

  const result = await renderProduction({
    timeline: enrichedCuts,
    narrationPath,
    narrationScript: narrationBeats,
    narrationTranscript,
    narrationCaptionPlan,
    hookDurationSec: hookDurSec,
    styleSpec,
    brainRotClipPath,
    brainRotDurationSec,
    outputPath: hintedOutputPath,
    onProgress: (p) => {
      try {
        setProgressStmt.run(JSON.stringify(p), prodId);
      } catch (err) {
        console.warn(`[prod ${prodId}] progress write failed:`, err);
      }
    },
  });
  // `result.outputPath` is the authoritative final location — an s3:// URI
  // for lambda renders, an absolute local path for local renders.
  setOutputPathStmt.run(result.outputPath, prodId);
}

// Helpful re-export for tests / one-off scripts.
export type { ProductionMode, ProductionRow };
