// MUST be the first import. See src/env.ts for why — TL;DR: ES imports
// hoist, so an inline try/catch here runs AFTER db.ts and pipeline.ts
// have already read their env-var-backed constants, silently missing
// any values that live only in .env.
import '../env.js';

import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { db } from '../db.js';
import { ensureOutputLifecycle } from '../lib/s3Outputs.js';
import { runPipeline } from './pipeline.js';
import { pruneExpiredSessions } from '../auth/sessions.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Atomically claim the oldest queued job. The single-statement UPDATE with a
// scalar subquery + RETURNING is atomic under SQLite WAL mode for one writer
// at a time — fine for the MVP. When we move to Temporal (or a multi-writer
// queue) this whole file goes away; pipeline.ts is the part worth keeping.
const claimQuery = db.prepare(`
  update jobs
  set status = 'running',
      startedAt = datetime('now'),
      lockedAt = datetime('now'),
      attempts = attempts + 1,
      updatedAt = datetime('now')
  where id = (
    select id from jobs
    where status = 'queued'
    order by createdAt asc
    limit 1
  )
  returning id
`);

const markDone = db.prepare(`
  update jobs
  set status = 'done',
      stage = null,
      finishedAt = datetime('now'),
      updatedAt = datetime('now')
  where id = ?
`);

const markFailed = db.prepare(`
  update jobs
  set status = 'failed',
      error = ?,
      finishedAt = datetime('now'),
      updatedAt = datetime('now')
  where id = ?
`);

function claimOne(): { id: string } | undefined {
  return claimQuery.get() as { id: string } | undefined;
}

async function processOne(): Promise<boolean> {
  const claimed = claimOne();
  if (!claimed) return false;

  try {
    await runPipeline(claimed.id);
    markDone.run(claimed.id);
    console.log(`[job ${claimed.id}] done`);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[job ${claimed.id}] failed:`, message);
    markFailed.run(message, claimed.id);
  }
  return true;
}

// Best-effort: delete every direct child of `dir` whose mtime is older
// than `maxAgeMs`. Used by the retention sweeper to mop up inputs/work/
// outputs from crashed jobs (the happy path deletes these synchronously
// at the end of runPipeline). Missing dirs are treated as empty — on a
// fresh install none of these exist until the first job runs.
//
// `protectedPaths` (optional) skips files whose absolute path appears in
// the set, regardless of age. The inputs sweep uses this to honor jobs
// with a future keepInputUntil deadline (editor opt-in retention).
async function sweepDir(
  dir: string,
  maxAgeMs: number,
  label: string,
  protectedPaths?: Set<string>,
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const full = join(dir, name);
    if (protectedPaths?.has(full)) continue;
    try {
      const st = await stat(full);
      if (st.mtimeMs < cutoff) {
        await rm(full, { recursive: true, force: true });
        removed++;
      }
    } catch (err) {
      // Race with another process, or dir disappeared — ignore.
      console.warn(`sweeper: ${label} ${full}:`, (err as Error).message);
    }
  }
  if (removed > 0) console.log(`sweeper: ${label} removed ${removed} entries from ${dir}`);
  return removed;
}

// Look up every input path whose owning job has a keepInputUntil deadline
// still in the future. The sweeper passes this set as `protectedPaths` so
// editor-flagged uploads survive past the default 1-hour mtime cutoff.
const selectKeptInputs = db.prepare(
  `select inputPath from jobs where keepInputUntil is not null and keepInputUntil > datetime('now')`,
);

function getProtectedInputPaths(): Set<string> {
  const rows = selectKeptInputs.all() as Array<{ inputPath: string }>;
  return new Set(rows.map((r) => resolve(r.inputPath)));
}

// Retention sweeper. Runs on a timer alongside the job loop. The happy
// path already deletes inputs/work at the end of each successful render
// (pipeline.ts); this catches leftovers from crashed jobs and local-mode
// outputs that nobody fetched.
async function runSweeper(): Promise<void> {
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  try {
    const kept = getProtectedInputPaths();
    await Promise.all([
      sweepDir(join(STORAGE_DIR, 'inputs'), ONE_HOUR, 'inputs', kept),
      sweepDir(join(STORAGE_DIR, 'work'), ONE_HOUR, 'work'),
      sweepDir(join(STORAGE_DIR, 'outputs'), ONE_DAY, 'outputs'),
    ]);
  } catch (err) {
    console.warn('sweeper: run failed (continuing):', (err as Error).message);
  }
  try {
    const pruned = pruneExpiredSessions();
    if (pruned > 0) console.log(`sweeper: pruned ${pruned} expired session(s)`);
  } catch (err) {
    console.warn('sweeper: session prune failed (continuing):', (err as Error).message);
  }
}

async function loop() {
  console.log('worker: started');

  // Install S3 lifecycle rules in Lambda mode so the bucket never
  // accumulates stale renders or staged inputs. Idempotent — see
  // s3Outputs.ts. Failures are non-fatal (logged + continue).
  if ((process.env.RENDER_MODE ?? 'local').toLowerCase() === 'lambda') {
    try {
      const { getLambdaState } = await import('./remotionLambda.js');
      const state = await getLambdaState();
      await ensureOutputLifecycle(state.bucketName);
    } catch (err) {
      console.warn('worker: lifecycle setup failed (continuing):', (err as Error).message);
    }
  }

  // Kick off the retention sweeper. Runs once immediately (so a just-
  // restarted container cleans up whatever its predecessor left behind)
  // then every SWEEP_INTERVAL_MS.
  runSweeper();
  const sweepTimer = setInterval(runSweeper, SWEEP_INTERVAL_MS);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('worker: shutting down...');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    try {
      const had = await processOne();
      if (!had) await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error('worker: poll error', err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  clearInterval(sweepTimer);
  db.close();
  process.exit(0);
}

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
