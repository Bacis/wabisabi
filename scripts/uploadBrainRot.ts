// Upload local /storage/brain-rot/*.mp4 to the Remotion Lambda bucket at
// the brain-rot/ prefix so Railway + Lambda renders can fetch them.
// Idempotent — HEAD's each key first, only uploads what's missing.
//
// Usage:
//   npx tsx scripts/uploadBrainRot.ts             # upload missing files
//   npx tsx scripts/uploadBrainRot.ts --list      # just show what's in S3
//   npx tsx scripts/uploadBrainRot.ts --force     # re-upload everything
process.loadEnvFile();

import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { getLambdaState } from '../src/worker/remotionLambda.js';
import { BRAIN_ROT_S3_PREFIX } from '../src/shared/brainRotPool.js';

const BRAIN_ROT_DIR = join(
  resolve(process.env.STORAGE_DIR ?? './storage'),
  'brain-rot',
);

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

async function main() {
  const args = new Set(process.argv.slice(2));
  const listOnly = args.has('--list');
  const force = args.has('--force');

  console.log('resolving Remotion Lambda bucket...');
  const state = await getLambdaState();
  const s3 = new S3Client({ region: state.region });
  console.log(`  region: ${state.region}`);
  console.log(`  bucket: ${state.bucketName}`);
  console.log(`  prefix: ${BRAIN_ROT_S3_PREFIX}`);
  console.log('');

  if (listOnly) {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: state.bucketName,
        Prefix: BRAIN_ROT_S3_PREFIX,
      }),
    );
    const contents = res.Contents ?? [];
    if (contents.length === 0) {
      console.log('(no brain-rot files in S3 yet — run without --list to upload)');
      return;
    }
    console.log(`${contents.length} file(s) in s3://${state.bucketName}/${BRAIN_ROT_S3_PREFIX}:`);
    for (const obj of contents) {
      const sizeMb = ((obj.Size ?? 0) / 1024 / 1024).toFixed(1);
      console.log(`  ${obj.Key}  (${sizeMb} MB, ${obj.LastModified?.toISOString()})`);
    }
    return;
  }

  let localEntries: string[];
  try {
    localEntries = await readdir(BRAIN_ROT_DIR);
  } catch (err) {
    console.error(`failed to read ${BRAIN_ROT_DIR}:`, err);
    console.error('(put your .mp4/.mov/.webm clips in that folder and rerun.)');
    process.exit(1);
  }

  const videos = localEntries.filter((n) => {
    const ext = extname(n).toLowerCase();
    return ext in MIME;
  });
  if (videos.length === 0) {
    console.log(`no video files found in ${BRAIN_ROT_DIR}`);
    return;
  }

  console.log(`found ${videos.length} local clip(s) in ${BRAIN_ROT_DIR}`);
  console.log('');

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const name of videos) {
    const localPath = join(BRAIN_ROT_DIR, name);
    const key = `${BRAIN_ROT_S3_PREFIX}${name}`;
    const ext = extname(name).toLowerCase();
    const contentType = MIME[ext]!;

    // HEAD first; skip if key already exists (unless --force).
    if (!force) {
      try {
        await s3.send(
          new HeadObjectCommand({ Bucket: state.bucketName, Key: key }),
        );
        console.log(`  SKIP ${name} (already in S3)`);
        skipped++;
        continue;
      } catch (err: unknown) {
        // A 404/NotFound means we should upload. Anything else is an
        // actual error.
        if (
          err && typeof err === 'object' && 'name' in err &&
          (err as { name: string }).name !== 'NotFound' &&
          (err as { name: string }).name !== 'NoSuchKey'
        ) {
          console.error(`  HEAD ${name} failed:`, err);
          failed++;
          continue;
        }
      }
    }

    try {
      const [body, info] = await Promise.all([readFile(localPath), stat(localPath)]);
      const sizeMb = (info.size / 1024 / 1024).toFixed(1);
      process.stdout.write(`  UPLOAD ${name} (${sizeMb} MB)... `);
      await s3.send(
        new PutObjectCommand({
          Bucket: state.bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      console.log('ok');
      uploaded++;
    } catch (err) {
      console.log('FAILED');
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log('');
  console.log(`done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
