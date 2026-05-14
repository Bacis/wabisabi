import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { db } from '../db.js';
import { extractAudio } from '../stages/extractAudio.js';
import { transcribe } from '../stages/transcribe.js';
import { enrichTranscript } from '../stages/enrichTranscript.js';
import { detectFaces } from '../stages/detectFaces.js';
import { renderCaptions } from '../stages/render.js';
import type { StyleSpec } from '../shared/styleSpec.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

const selectJobStmt = db.prepare(`select * from jobs where id = ?`);
const setStageStmt = db.prepare(
  `update jobs set stage = ?, updatedAt = datetime('now') where id = ?`,
);
const setTranscriptStmt = db.prepare(
  `update jobs set transcript = ?, updatedAt = datetime('now') where id = ?`,
);
const setCaptionPlanStmt = db.prepare(
  `update jobs set captionPlan = ?, updatedAt = datetime('now') where id = ?`,
);
const setFacesStmt = db.prepare(
  `update jobs set faces = ?, updatedAt = datetime('now') where id = ?`,
);
const setOutputPathStmt = db.prepare(
  `update jobs set outputPath = ?, updatedAt = datetime('now') where id = ?`,
);
const setProgressStmt = db.prepare(
  `update jobs set progress = ?, updatedAt = datetime('now') where id = ?`,
);

type JobRow = {
  id: string;
  status: string;
  stage: string | null;
  inputPath: string;
  outputPath: string | null;
  templateId: string;
  styleSpec: string; // JSON text
  transcript: string | null; // JSON text
  captionPlan: string | null; // JSON text
  faces: string | null; // JSON text
  error: string | null;
  attempts: number;
  keepInputUntil: string | null; // datetime; if set + future, skip end-of-render cleanup
};

function setStage(jobId: string, stage: string) {
  console.log(`[job ${jobId}] -> ${stage}`);
  setStageStmt.run(stage, jobId);
}

export async function runPipeline(jobId: string): Promise<void> {
  const row = selectJobStmt.get(jobId) as JobRow | undefined;
  if (!row) throw new Error(`job ${jobId} not found`);

  const styleSpec = JSON.parse(row.styleSpec) as StyleSpec;
  const inputAbs = resolve(row.inputPath);

  const workDir = join(STORAGE_DIR, 'work', jobId);
  await mkdir(workDir, { recursive: true });

  // Caption Designer renders (and any other job that was created with a
  // pre-authored transcript + captionPlan) skip the transcribe / enrich /
  // face-detect stages. Re-running Whisper would discard the user's word
  // edits; the editor's caption-track text is the source of truth.
  const skipAnalysis = row.transcript && row.captionPlan;

  let transcript;
  let faces;
  let captionPlan;

  if (skipAnalysis) {
    setStage(jobId, 'analyze');
    console.log(`[job ${jobId}] caption-designer: reusing pre-authored transcript + captionPlan`);
    transcript = JSON.parse(row.transcript!);
    captionPlan = JSON.parse(row.captionPlan!);
    faces = row.faces && row.faces !== 'null' ? JSON.parse(row.faces) : null;
  } else {
    // 1. Extract mono 16kHz audio for the transcriber.
    setStage(jobId, 'extract_audio');
    const audioPath = join(workDir, 'audio.wav');
    await extractAudio(inputAbs, audioPath);

    // 2 + 3. Transcribe and face-detect in parallel. They're independent —
    // transcribe consumes the extracted WAV, detectFaces reads the source
    // video — and on a typical job transcribe is the slower of the two
    // (~10s on cached models vs ~6s for face sampling), so the face cost
    // hides entirely behind transcribe. Each branch saves its own result so
    // partial progress is durable. Face detection failures are non-fatal —
    // the render falls back to the user's preferred position.
    setStage(jobId, 'analyze');
    console.log(`[job ${jobId}] running transcribe + detect_faces in parallel`);
    [transcript, faces] = await Promise.all([
      transcribe(audioPath).then((t) => {
        console.log(`[job ${jobId}] transcribe done (${t.words.length} words)`);
        setTranscriptStmt.run(JSON.stringify(t), jobId);
        return t;
      }),
      detectFaces(inputAbs)
        .then((f) => {
          const withFaces = f.samples.filter((s) => s.faces.length > 0).length;
          console.log(
            `[job ${jobId}] detect_faces done (${withFaces}/${f.samples.length} samples)`,
          );
          setFacesStmt.run(JSON.stringify(f), jobId);
          return f;
        })
        .catch((err) => {
          console.error(`[job ${jobId}] face detection failed (continuing):`, err);
          return null;
        }),
    ]);

    // 4. LLM enrichment: semantic chunking + per-word emphasis. Returns null
    // if no API key is set or the call fails — the render template will then
    // fall back to its built-in fixed-N chunker.
    setStage(jobId, 'enrich');
    captionPlan = await enrichTranscript(transcript);
    if (captionPlan) {
      setCaptionPlanStmt.run(JSON.stringify(captionPlan), jobId);
    }
  }

  // 5. Render the final video. Remotion's <OffthreadVideo> plays the source
  // video underneath the caption layer, so the rendered file is the output.
  setStage(jobId, 'render');
  const outputDir = join(STORAGE_DIR, 'outputs');
  await mkdir(outputDir, { recursive: true });
  // outputPath is a *hint* — local mode writes to it verbatim, Lambda mode
  // uses its basename as the S3 key under jobs/ and returns an s3:// URI.
  // The authoritative location comes back in result.outputPath.
  const outputHint = join(outputDir, `${jobId}.mp4`);
  const result = await renderCaptions({
    inputVideo: inputAbs,
    transcript,
    captionPlan,
    faces,
    styleSpec,
    templateId: row.templateId,
    outputPath: outputHint,
    onProgress: (p) => {
      // Write to DB so the viewer can poll and show live progress. Failures
      // here are intentionally swallowed — a missed progress write must not
      // fail the render itself.
      try {
        setProgressStmt.run(JSON.stringify(p), jobId);
      } catch (err) {
        console.warn(`[job ${jobId}] progress write failed:`, err);
      }
    },
  });

  setOutputPathStmt.run(result.outputPath, jobId);

  // 6. Reclaim per-job disk. Work/ is always safe to drop — it only held
  // the extracted audio.wav. Input is dropped too: in Lambda mode it's
  // already been uploaded to S3 and rendered; in local mode the rendered
  // output is self-contained. The `sourceJobId` reprocess-from-original
  // feature was dropped for cost safety on 24/7 deployments — the API
  // surface still accepts it, but the input file will be gone for any job
  // that's completed.
  //
  // Best-effort: a failure here must not mark the job failed — the render
  // succeeded. The retention sweeper in worker/index.ts will mop up any
  // stragglers from crashed cleanups.
  await rm(workDir, { recursive: true, force: true }).catch((err) =>
    console.warn(`[job ${jobId}] cleanup workDir failed:`, (err as Error).message),
  );
  // Editor opt-in: if the job declared keepInputUntil and the deadline is
  // still in the future, leave the input on disk so the editor's still-frame
  // preview (and Phase 2's @remotion/player) can keep using it. The retention
  // sweeper checks the same column, so the file will eventually be reaped.
  const keepUntilStr = row.keepInputUntil;
  const keepUntilMs = keepUntilStr ? Date.parse(keepUntilStr.replace(' ', 'T') + 'Z') : NaN;
  if (Number.isFinite(keepUntilMs) && keepUntilMs > Date.now()) {
    console.log(`[job ${jobId}] keeping input until ${keepUntilStr} (editor opt-in)`);
  } else {
    await rm(inputAbs, { force: true }).catch((err) =>
      console.warn(`[job ${jobId}] cleanup input failed:`, (err as Error).message),
    );
  }
}
