// Programmatic render trigger + polling — the back-end of the Atelier
// `render` tool. Creates a job row via the same insertJob path as POST
// /jobs and watches it through the worker queue. The worker process
// (src/worker/index.ts) does the actual work; we just wait for status
// to settle.

import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { StyleSpecSchema } from '../shared/styleSpec.js';
import { parseS3Uri, presignOutputUrl } from './s3Outputs.js';
import { getClipSourceUri } from './clipIngest.js';

const insertJob = db.prepare(`
  insert into jobs
    (id, userId, inputPath, templateId, styleSpec, userVideoId, widthPx, heightPx, hidden)
  values
    (@id, @userId, @inputPath, @templateId, @styleSpec, @userVideoId, @widthPx, @heightPx, 1)
  returning id, status, stage
`);

const selectJob = db.prepare(
  `select id, status, stage, outputPath, error, progress
     from jobs where id = ? and userId = ?`,
);

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type RenderStatus = {
  jobId: string;
  status: JobStatus;
  stage: string | null;
  outputUrl?: string;
  error?: string;
  progressPct?: number;
};

type JobRow = {
  id: string;
  status: JobStatus;
  stage: string | null;
  outputPath: string | null;
  error: string | null;
  progress: string | null;
};

/**
 * Create a queued render job for a previously-ingested clip. The agent's
 * MCP render tool calls this with the current styleSpec (snapshotted from
 * the agent state). All jobs created via this path are marked hidden=1
 * so they don't clutter the web user's job list — MCP is a separate
 * surface and we don't want each draft render appearing as a separate row
 * in the sidebar.
 */
/**
 * Block until a clip's user_videos.status is 'ready' or the deadline
 * passes. Returns the final status. Lets the render tool serialize
 * naturally after an in-flight background upload from
 * registerClipFromPath, without surfacing the wait to the agent.
 */
export async function awaitClipReady(input: {
  clipId: string;
  userId: string;
  deadlineMs: number;
}): Promise<'ready' | 'uploading' | 'failed' | 'missing'> {
  while (Date.now() < input.deadlineMs) {
    const row = db
      .prepare(`select status from user_videos where id = ? and userId = ?`)
      .get(input.clipId, input.userId) as { status: string } | undefined;
    if (!row) return 'missing';
    if (row.status === 'ready') return 'ready';
    if (row.status === 'failed') return 'failed';
    await new Promise((r) => setTimeout(r, 1000));
  }
  const row = db
    .prepare(`select status from user_videos where id = ? and userId = ?`)
    .get(input.clipId, input.userId) as { status: string } | undefined;
  if (!row) return 'missing';
  if (row.status === 'ready') return 'ready';
  if (row.status === 'failed') return 'failed';
  return 'uploading';
}

/**
 * Find the most recent render job for (userId, clipId). The render tool
 * uses this to dedupe — if Atelier asks to render a clip that already
 * has an in-flight or finished job, we surface that job's status
 * instead of stacking duplicates. Without dedup, every "ready yet?"
 * follow-up turn creates a new job and the queue grows unboundedly.
 *
 * Returned in reverse-chronological order; caller decides whether to
 * reuse based on status (done → reuse, queued/running → reuse, failed
 * → create fresh).
 */
export function findRecentJobForClip(input: {
  userId: string;
  clipId: string;
}): { jobId: string; status: JobStatus; createdAt: string } | null {
  const row = db
    .prepare(
      `select id, status, createdAt
         from jobs
        where userId = ? and userVideoId = ?
        order by createdAt desc
        limit 1`,
    )
    .get(input.userId, input.clipId) as
    | { id: string; status: JobStatus; createdAt: string }
    | undefined;
  if (!row) return null;
  return { jobId: row.id, status: row.status, createdAt: row.createdAt };
}

export function createRenderJob(input: {
  userId: string;
  clipId: string;
  styleSpec: Record<string, unknown>;
  templateId?: string;
}): { jobId: string } {
  // Safety net — the render tool is expected to call awaitClipReady
  // first, but if a caller skips it we still produce a helpful error
  // instead of inserting a job that will fail mid-pipeline.
  const row = db
    .prepare(
      `select status from user_videos where id = ? and userId = ?`,
    )
    .get(input.clipId, input.userId) as { status: string } | undefined;
  if (!row) {
    throw new Error(
      `clip ${input.clipId} not found. Re-ingest via register_clip_from_path or register_clip_from_url.`,
    );
  }
  if (row.status !== 'ready') {
    throw new Error(
      `clip ${input.clipId} status=${row.status} — upload hasn't finished. The render tool should call awaitClipReady first.`,
    );
  }
  const source = getClipSourceUri({ clipId: input.clipId, userId: input.userId });
  if (!source) {
    throw new Error(`clip ${input.clipId} not ready or not owned by user`);
  }

  const parsed = StyleSpecSchema.safeParse(input.styleSpec ?? {});
  if (!parsed.success) {
    throw new Error(`invalid styleSpec: ${parsed.error.message}`);
  }

  const jobId = randomUUID();
  insertJob.get({
    id: jobId,
    userId: input.userId,
    inputPath: source.uri,
    templateId: input.templateId ?? 'reel-clone',
    styleSpec: JSON.stringify(parsed.data),
    userVideoId: input.clipId,
    widthPx: source.widthPx,
    heightPx: source.heightPx,
  });
  return { jobId };
}

async function presignIfPossible(outputPath: string | null): Promise<string | undefined> {
  if (!outputPath) return undefined;
  if (parseS3Uri(outputPath)) {
    try {
      return await presignOutputUrl(outputPath, 3600);
    } catch {
      return undefined;
    }
  }
  // Local file path (RENDER_MODE=local) — caller has to fetch via the
  // existing /jobs/:id/output endpoint with their api key. Return the path
  // so the agent can mention it; the MCP tool layer turns it into an
  // authenticated URL.
  return outputPath;
}

function pctFromProgress(raw: string | null): number | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { framesRendered?: number; framesTotal?: number };
    if (
      typeof parsed.framesRendered === 'number' &&
      typeof parsed.framesTotal === 'number' &&
      parsed.framesTotal > 0
    ) {
      return Math.round((parsed.framesRendered / parsed.framesTotal) * 100);
    }
  } catch {
    // unparseable, ignore
  }
  return undefined;
}

export async function getRenderStatus(input: {
  jobId: string;
  userId: string;
}): Promise<RenderStatus | null> {
  const row = selectJob.get(input.jobId, input.userId) as JobRow | undefined;
  if (!row) return null;
  const result: RenderStatus = {
    jobId: row.id,
    status: row.status,
    stage: row.stage,
  };
  if (row.error) result.error = row.error;
  const pct = pctFromProgress(row.progress);
  if (pct !== undefined) result.progressPct = pct;
  if (row.status === 'done') {
    const url = await presignIfPossible(row.outputPath);
    if (url) result.outputUrl = url;
  }
  return result;
}

/**
 * Long-poll a render job. Resolves when the job hits terminal state
 * (done or failed) OR when the wait window expires. Default 30s, hard
 * cap 120s — keeps a single MCP tool call responsive for short clips
 * while degrading gracefully (caller re-polls) for long ones.
 */
export async function pollRender(input: {
  jobId: string;
  userId: string;
  waitMs?: number;
}): Promise<RenderStatus> {
  // Cap at 25s — same MCP-transport timeout reasoning as the render
  // tool wrapper. See agentChat.ts.
  const deadline = Date.now() + Math.min(Math.max(input.waitMs ?? 20_000, 500), 25_000);
  while (true) {
    const status = await getRenderStatus({ jobId: input.jobId, userId: input.userId });
    if (!status) {
      throw new Error(`render job ${input.jobId} not found`);
    }
    if (status.status === 'done' || status.status === 'failed') return status;
    if (Date.now() >= deadline) return status;
    await new Promise((r) => setTimeout(r, 500));
  }
}
