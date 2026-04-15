// MUST be first import — see src/env.ts.
import '../env.js';

import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { db } from '../db.js';
import { ensureOutputLifecycle } from '../lib/s3Outputs.js';
import { runProductionPipeline } from './producerPipeline.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

// Second worker loop — pulls from the productions table, independent of the
// single-video jobs loop in worker/index.ts. Both can run concurrently
// against the same SQLite DB since they claim different tables.

const claimQuery = db.prepare(`
  update productions
  set status = 'running',
      startedAt = datetime('now'),
      lockedAt = datetime('now'),
      attempts = attempts + 1,
      updatedAt = datetime('now')
  where id = (
    select id from productions
    where status = 'queued'
    order by createdAt asc
    limit 1
  )
  returning id
`);

const markDone = db.prepare(`
  update productions
  set status = 'done',
      stage = null,
      finishedAt = datetime('now'),
      updatedAt = datetime('now')
  where id = ?
`);

const markFailed = db.prepare(`
  update productions
  set status = 'failed',
      error = ?,
      finishedAt = datetime('now'),
      updatedAt = datetime('now')
  where id = ?
`);

function claimOne(): { id: string } | undefined {
  return claimQuery.get() as { id: string } | undefined;
}

// On successful pipeline completion, reclaim the per-production disk
// footprint: `work/` (cut segments, narration.mp3) and `assets/` (original
// uploads from Telegram). We keep `output/` untouched — Lambda renders
// never write to it, and local renders still need it as the served path.
// Failures intentionally keep everything so a retry can reuse the state
// and an operator can inspect the crash scene.
async function cleanupAfterSuccess(prodId: string): Promise<void> {
  const prodRoot = join(STORAGE_DIR, 'productions', prodId);
  for (const sub of ['work', 'assets'] as const) {
    const path = join(prodRoot, sub);
    try {
      await rm(path, { recursive: true, force: true });
    } catch (err) {
      // Non-fatal — disk cleanup is best-effort. Worst case: a future sweep
      // or the operator handles it.
      console.warn(`[prod ${prodId}] cleanup failed for ${sub}:`, (err as Error).message);
    }
  }
}

async function processOne(): Promise<boolean> {
  const claimed = claimOne();
  if (!claimed) return false;
  try {
    await runProductionPipeline(claimed.id);
    markDone.run(claimed.id);
    await cleanupAfterSuccess(claimed.id);
    console.log(`[prod ${claimed.id}] done`);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[prod ${claimed.id}] failed:`, message);
    markFailed.run(message, claimed.id);
  }
  return true;
}

async function loop() {
  console.log('producer worker: started');
  // One-time, idempotent: ensure the S3 bucket we render into has a
  // lifecycle rule that expires productions/ objects after 7 days. Only
  // runs when the worker is configured for lambda renders — local mode
  // never writes to S3.
  if ((process.env.RENDER_MODE ?? 'local').toLowerCase() === 'lambda') {
    try {
      const { getLambdaState } = await import('./remotionLambda.js');
      const state = await getLambdaState();
      await ensureOutputLifecycle(state.bucketName);
    } catch (err) {
      // Lifecycle setup failing must NOT prevent the worker from claiming
      // jobs — warn and continue.
      console.warn('producer worker: lifecycle setup failed (continuing):', (err as Error).message);
    }
  }
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('producer worker: shutting down...');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    try {
      const had = await processOne();
      if (!had) await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error('producer worker: poll error', err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  db.close();
  process.exit(0);
}

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
