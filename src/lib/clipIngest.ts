// Programmatic clip ingest — the back-end of the Atelier MCP tools.
//
// Mirrors the HTTP /uploads/init + /uploads/:id/finalize handshake but
// callable in-process from agent tools. Returns plain objects (no Fastify
// reply machinery), so the same code paths work from either entry point.

import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db } from '../db.js';
import {
  getUploadBucket,
  headObject,
  presignPutUrl,
} from './s3Outputs.js';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|qt|3gp)$/i;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB — matches /uploads/init

let cachedS3: S3Client | null = null;
function getS3(): S3Client {
  if (!cachedS3) cachedS3 = new S3Client({ region: REGION });
  return cachedS3;
}

function sniffMime(filename: string, declared?: string): string {
  if (declared && declared.startsWith('video/')) return declared;
  const m = filename.toLowerCase().match(VIDEO_EXT_RE);
  if (!m) return 'video/mp4';
  const ext = m[1];
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'mov' || ext === 'qt') return 'video/quicktime';
  return 'video/mp4';
}

const insertUserVideo = db.prepare(`
  insert into user_videos
    (id, userId, displayName, originalFilename, s3Bucket, s3Key, sizeBytes, mimeType, status)
  values
    (@id, @userId, @displayName, @originalFilename, @s3Bucket, @s3Key, @sizeBytes, @mimeType, 'pending')
`);
const markReady = db.prepare(`
  update user_videos
     set status = 'ready', sizeBytes = coalesce(@sizeBytes, sizeBytes), updatedAt = datetime('now')
   where id = @id and userId = @userId
`);
const selectClip = db.prepare(
  `select id, status, s3Bucket, s3Key, displayName, sizeBytes, durationSec, mimeType
     from user_videos where id = ? and userId = ?`,
);

export type ClipUploadInit = {
  clipId: string;
  uploadUrl: string;
  contentType: string;
  expiresInSec: number;
  maxBytes: number;
};

/**
 * Reserve a user_videos row and presign a PUT URL the MCP client can
 * upload to directly. The clip is created in status='pending'; call
 * `markClipReadyIfUploaded` (typically from get_clip) once the PUT is done.
 */
export async function initClipUpload(input: {
  userId: string;
  filename: string;
  sizeBytes?: number;
  mimeType?: string;
}): Promise<ClipUploadInit> {
  const filename = input.filename.trim();
  if (!filename) throw new Error('filename is required');
  if (!VIDEO_EXT_RE.test(filename)) {
    throw new Error('filename must end in a video extension (.mp4, .mov, …)');
  }
  if (input.sizeBytes != null && input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`file too large (max ${MAX_UPLOAD_BYTES} bytes)`);
  }

  const bucket = getUploadBucket();
  const id = randomUUID();
  const extMatch = filename.toLowerCase().match(VIDEO_EXT_RE);
  const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
  const s3Key = `user-videos/${id}${ext}`;
  const mimeType = sniffMime(filename, input.mimeType);
  const expiresInSec = 3600; // 1h — MCP clients may need more setup time than browser uploads

  const uploadUrl = await presignPutUrl(bucket, s3Key, mimeType, expiresInSec);

  insertUserVideo.run({
    id,
    userId: input.userId,
    displayName: filename,
    originalFilename: filename,
    s3Bucket: bucket,
    s3Key,
    sizeBytes: input.sizeBytes ?? null,
    mimeType,
  });

  return {
    clipId: id,
    uploadUrl,
    contentType: mimeType,
    expiresInSec,
    maxBytes: MAX_UPLOAD_BYTES,
  };
}

export type ClipStatus = {
  clipId: string;
  status: 'pending' | 'ready' | 'failed';
  filename: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  mimeType: string | null;
};

type ClipRow = {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  s3Bucket: string;
  s3Key: string;
  displayName: string;
  sizeBytes: number | null;
  durationSec: number | null;
  mimeType: string | null;
};

/**
 * Returns the clip's current state. If status is still 'pending' but the
 * S3 object has actually landed, flip to 'ready' on the spot — saves the
 * caller a separate finalize call. Failures (object missing past expiry)
 * are left as 'pending'; the row stays around for the lifecycle sweeper.
 */
export async function getClipStatus(input: {
  clipId: string;
  userId: string;
}): Promise<ClipStatus | null> {
  const row = selectClip.get(input.clipId, input.userId) as ClipRow | undefined;
  if (!row) return null;

  if (row.status === 'pending') {
    try {
      const head = await headObject(row.s3Bucket, row.s3Key);
      if (head) {
        markReady.run({
          id: row.id,
          userId: input.userId,
          sizeBytes: head.contentLength ?? null,
        });
        row.status = 'ready';
        if (head.contentLength != null) row.sizeBytes = head.contentLength;
      }
    } catch {
      // Leave as pending — caller can retry.
    }
  }

  return {
    clipId: row.id,
    status: row.status,
    filename: row.displayName,
    sizeBytes: row.sizeBytes,
    durationSec: row.durationSec,
    mimeType: row.mimeType,
  };
}

/**
 * Download a remote URL and register it as a user_video. Streams through
 * memory once — Node `fetch` body is a web ReadableStream, which we adapt
 * to Node Readable for the S3 PUT. Caps at MAX_UPLOAD_BYTES via the
 * Content-Length header check; truly unknown sizes are still allowed but
 * the operator should expect lifecycle pruning to GC abuse.
 */
export async function registerClipFromUrl(input: {
  userId: string;
  url: string;
  filename?: string;
}): Promise<{ clipId: string; sizeBytes: number | null }> {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('url must be an http(s) URL');
  }

  // Reasonable filename inference if caller didn't pass one.
  const guessedName =
    input.filename ?? (() => {
      try {
        const u = new URL(url);
        const tail = u.pathname.split('/').pop() ?? '';
        return tail && VIDEO_EXT_RE.test(tail) ? tail : `clip-${Date.now()}.mp4`;
      } catch {
        return `clip-${Date.now()}.mp4`;
      }
    })();

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
  }
  const contentLength = res.headers.get('content-length');
  const sizeBytes = contentLength ? Number(contentLength) : null;
  if (sizeBytes != null && sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`remote file too large (${sizeBytes} > ${MAX_UPLOAD_BYTES})`);
  }
  if (!res.body) {
    throw new Error('fetch returned no body');
  }

  const bucket = getUploadBucket();
  const id = randomUUID();
  const extMatch = guessedName.toLowerCase().match(VIDEO_EXT_RE);
  const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
  const s3Key = `user-videos/${id}${ext}`;
  const mimeType =
    res.headers.get('content-type')?.split(';')[0]?.trim() ?? sniffMime(guessedName);

  // Reserve the row up-front so failures still produce a debuggable clipId
  // in get_clip rather than vanishing silently.
  insertUserVideo.run({
    id,
    userId: input.userId,
    displayName: guessedName,
    originalFilename: guessedName,
    s3Bucket: bucket,
    s3Key,
    sizeBytes: sizeBytes ?? null,
    mimeType,
  });

  const nodeStream = Readable.fromWeb(res.body as never);
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: nodeStream as never,
      ContentType: mimeType,
      ContentLength: sizeBytes ?? undefined,
    }),
  );

  markReady.run({
    id,
    userId: input.userId,
    sizeBytes: sizeBytes ?? null,
  });

  return { clipId: id, sizeBytes };
}

const markFailed = db.prepare(
  `update user_videos set status = 'failed', updatedAt = datetime('now')
    where id = ? and userId = ?`,
);

/**
 * Read a video file off the wabisabi server's own filesystem and register
 * it as a user_video. Intended for the localhost dev case where the user's
 * AI client (Claude Desktop, Cursor) lives on the same machine as the API.
 *
 * **Returns immediately** with `{clipId, sizeBytes, status: 'uploading'}`.
 * The S3 PUT runs in the background — a 50 MB file over a slow residential
 * uplink can take minutes, and blocking the agent's tool call for that
 * long blows past upstream LLM timeouts. The render path is clip-ready
 * aware (pollRender waits for status='ready' before kicking off the
 * pipeline), so the agent can fire-and-forget here and the render call
 * naturally serializes after the upload completes.
 */
export function registerClipFromPath(input: {
  userId: string;
  path: string;
}): { clipId: string; sizeBytes: number; status: 'uploading' } {
  const path = input.path.trim();
  if (!path || !isAbsolute(path)) {
    throw new Error('path must be an absolute filesystem path');
  }

  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      throw new Error('path exists but is not a regular file');
    }
    size = stat.size;
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(`file too large (${size} > ${MAX_UPLOAD_BYTES})`);
  }
  if (!VIDEO_EXT_RE.test(path)) {
    throw new Error('path must end in a video extension (.mp4, .mov, …)');
  }

  const bucket = getUploadBucket();
  const id = randomUUID();
  const extMatch = path.toLowerCase().match(VIDEO_EXT_RE);
  const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
  const s3Key = `user-videos/${id}${ext}`;
  const baseName = path.split('/').pop() ?? `clip-${id}${ext}`;
  const mimeType = sniffMime(baseName);

  insertUserVideo.run({
    id,
    userId: input.userId,
    displayName: baseName,
    originalFilename: baseName,
    s3Bucket: bucket,
    s3Key,
    sizeBytes: size,
    mimeType,
  });

  // Fire the upload in the background. Errors land on the row's status
  // ('failed') so callers can detect them via getClipStatus / the render
  // preflight. We deliberately don't `await` here — see the docstring.
  void (async () => {
    const startMs = Date.now();
    try {
      await getS3().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: createReadStream(path),
          ContentType: mimeType,
          ContentLength: size,
        }),
      );
      markReady.run({
        id,
        userId: input.userId,
        sizeBytes: size,
      });
      console.log(
        `register_clip_from_path: ${baseName} (${(size / 1e6).toFixed(1)} MB) uploaded in ${Date.now() - startMs}ms → clipId=${id}`,
      );
    } catch (err) {
      console.error(
        `register_clip_from_path: upload failed for ${baseName} (${id}):`,
        (err as Error).message,
      );
      try {
        markFailed.run(id, input.userId);
      } catch {
        // ignore — row might already be gone
      }
    }
  })();

  return { clipId: id, sizeBytes: size, status: 'uploading' };
}

/** Tail-end util used by render code — resolves the s3:// URI for a clip. */
export function getClipSourceUri(input: {
  clipId: string;
  userId: string;
}): { uri: string; widthPx: number | null; heightPx: number | null } | null {
  const row = db
    .prepare(
      `select s3Bucket, s3Key, widthPx, heightPx from user_videos
        where id = ? and userId = ? and status = 'ready'`,
    )
    .get(input.clipId, input.userId) as
    | { s3Bucket: string; s3Key: string; widthPx: number | null; heightPx: number | null }
    | undefined;
  if (!row) return null;
  return {
    uri: `s3://${row.s3Bucket}/${row.s3Key}`,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
  };
}
