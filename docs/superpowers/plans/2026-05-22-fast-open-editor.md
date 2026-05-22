# Fast open-editor for uploads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the upload → job-queue → worker pipeline on the editor-open path with a parallel browser-extract → warm-sidecar → designer-mount path, so the designer view appears in ~5s for typical short clips instead of 30–60s.

**Architecture:** Browser uses `ffmpeg.wasm` (lazy-loaded) to extract 16kHz mono WAV before/during upload. A long-running Python FastAPI sidecar holds `large-v3` warm and exposes a localhost `/transcribe` endpoint. The Node API gets two new endpoints — `POST /transcribe` (multipart fast-path) and `POST /transcribe-from-upload` (server-extract fallback) — both writing the result onto a new `user_videos.transcript` column. `useEditableSource` learns a new `'upload'` kind that resolves immediately from the inlined transcript. `StartPage` for upload starters drives the three-step handshake (`/uploads/init` → parallel S3 PUT + `/transcribe` → `/uploads/:id/finalize`) instead of minting a job. Jobs are only created at Export.

**Tech Stack:** TypeScript / Fastify (API), Python 3.11 / FastAPI / uvicorn / faster-whisper (sidecar), React / Vite / `@ffmpeg/ffmpeg` 0.12 (web), better-sqlite3 (DB), vitest (tests).

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-05-22-fast-open-editor-design.md`
- Existing upload init/finalize: `src/api/server.ts:2026` and `src/api/server.ts:2099`
- Existing transcribe pipeline (will remain as fallback for Export-time): `src/stages/transcribe.ts`
- Worker skipAnalysis branch (still used at Export): `src/worker/pipeline.ts:97`

---

## File structure

**New files:**
- `transcribe-py/server.py` — FastAPI sidecar holding `large-v3` warm
- `src/transcribeSidecar.ts` — Node client for sidecar (HTTP POST to localhost)
- `src/transcribeSidecar.spec.ts` — sidecar client tests against a stub HTTP server
- `src/shared/fastUpload.ts` — pure orchestrator (init → parallel transcribe + S3 PUT → finalize). Lives under `src/shared/` so vitest picks it up and the web imports it via the existing `@shared/*` alias.
- `src/shared/fastUpload.spec.ts` — orchestrator tests with mocked API fns
- `web/src/lib/extractAudio.ts` — ffmpeg.wasm wrapper (lazy-load, decode to 16kHz mono WAV)
- `web/src/lib/useFastUpload.ts` — React hook wrapping the pure orchestrator with progress state
- `tests/integration/transcribe-endpoint.test.ts` — integration test that spawns the sidecar + API and exercises `POST /transcribe`

**Modified files:**
- `db/schema.sql` — add `transcript TEXT` to `user_videos`
- `src/db.ts` — `ensureColumn('user_videos', 'transcript', 'TEXT')`
- `src/api/server.ts` — add `POST /transcribe`, `POST /transcribe-from-upload`; include `transcript` in `GET /uploads/:id` response
- `src/auth/middleware.ts` — already touched, no change here
- `web/src/lib/api.ts` — add `postTranscribe`, `postTranscribeFromUpload`; extend `getUpload` return type with `transcript`
- `web/src/lib/useEditableSource.ts` — new `'upload'` kind branch
- `web/src/pages/start/StartPage.tsx` — gate Generate flow on `useFastUpload` when starter is upload and `UPLOAD_FAST_PATH` flag is on; keep `createJobFromUpload` path as fallback
- `web/tsconfig.json` — add `@shared/fastUpload` alias entry
- `transcribe-py/requirements-cpu.txt` — add `fastapi`, `uvicorn[standard]`
- `package.json` — add `npm run sidecar` script (dev)
- `scripts/start.sh` — launch sidecar before worker
- `Dockerfile` — no change needed (Python venv already installs requirements-cpu.txt)
- `web/package.json` — add `@ffmpeg/ffmpeg` and `@ffmpeg/util`

---

## Task 0: Clean up stuck queued jobs and confirm starting state

**Files:**
- DB: `storage/captions.db`

- [ ] **Step 1: List currently-stuck queued jobs.**

Run:
```bash
sqlite3 -header -column storage/captions.db "SELECT id, status, datetime(createdAt), substr(inputPath,1,60) FROM jobs WHERE status NOT IN ('done','failed') ORDER BY createdAt DESC;"
```

Expected: a small handful of `queued` rows or none.

- [ ] **Step 2: Mark them failed (they predate the new flow and will never drain since no worker is running).**

Run:
```bash
sqlite3 storage/captions.db "UPDATE jobs SET status='failed', error='cancelled: stale queue entry — pre fast-path', stage='cancelled', finishedAt=datetime('now'), updatedAt=datetime('now') WHERE status='queued';"
```

- [ ] **Step 3: Verify the queue is empty.**

Run:
```bash
sqlite3 storage/captions.db "SELECT COUNT(*) FROM jobs WHERE status='queued';"
```

Expected: `0`.

- [ ] **Step 4: Commit (DB is in storage/ which is gitignored; commit nothing — this is a state reset, not a code change).**

No commit. Move on.

---

## Task 1: Add `transcript` column to `user_videos`

**Files:**
- Modify: `db/schema.sql`
- Modify: `src/db.ts`
- Test: `src/shared/userVideoSchema.spec.ts` (new)

- [ ] **Step 1: Write the failing test first.**

Create `src/shared/userVideoSchema.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { db } from '../db.js';

describe('user_videos schema', () => {
  it('has a nullable transcript TEXT column', () => {
    const cols = db
      .prepare(`PRAGMA table_info(user_videos)`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const transcript = cols.find((c) => c.name === 'transcript');
    expect(transcript).toBeDefined();
    expect(transcript!.type.toUpperCase()).toBe('TEXT');
    expect(transcript!.notnull).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.**

```bash
npm test -- src/shared/userVideoSchema.spec.ts
```

Expected: FAIL (`transcript` is `undefined`).

- [ ] **Step 3: Add the column idempotently in `src/db.ts`.**

Open `src/db.ts`. Right after the existing block of `ensureColumn` calls (around line 87, between the `user_videos` width/height additions and the `agent_threads` additions), insert:

```ts
// user_videos.transcript holds the result of the fast-path /transcribe
// call so the editor can mount directly from the upload without polling
// a job row. JSON blob, same shape as today's jobs.transcript / Transcript
// type. NULL until the first /transcribe call for that asset succeeds.
ensureColumn('user_videos', 'transcript', 'TEXT');
```

- [ ] **Step 4: Add the same column to `db/schema.sql` so fresh DBs ship with it.**

In `db/schema.sql`, find the `create table if not exists user_videos (...)` block and add `transcript text,` right above the closing paren (or wherever fits the existing style — after `mimeType` is fine).

- [ ] **Step 5: Re-run the test.**

```bash
npm test -- src/shared/userVideoSchema.spec.ts
```

Expected: PASS (the `db.ts` import triggers the migration on module load).

- [ ] **Step 6: Verify directly against the running DB.**

```bash
sqlite3 storage/captions.db "PRAGMA table_info(user_videos);" | grep transcript
```

Expected: a row showing `transcript|TEXT|0|...`.

- [ ] **Step 7: Commit.**

```bash
git add db/schema.sql src/db.ts src/shared/userVideoSchema.spec.ts
git commit -m "schema: add user_videos.transcript column for fast-path transcript persistence"
```

---

## Task 2: Surface `transcript` in `GET /uploads/:id`

**Files:**
- Modify: `src/api/server.ts` (find the existing `GET /uploads/:id` handler and the select-statement near line 396)
- Test: `src/api/uploadsGet.spec.ts` (new)

- [ ] **Step 1: Locate the existing endpoint and the select statement.**

Run:
```bash
grep -n "selectUserVideoForUser\|app.get.*uploads/:id" src/api/server.ts | head
```

Note the line numbers — you'll need to add `transcript` to whatever shape the handler currently returns.

- [ ] **Step 2: Write the failing test first.**

Create `src/api/uploadsGet.spec.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';

const TEST_USER_ID = `system:uploads-get-spec-${randomUUID().slice(0, 8)}`;
const TEST_VIDEO_ID = `uv-${randomUUID().slice(0, 8)}`;

beforeAll(() => {
  db.prepare(
    `insert into users (id, email, passwordHash) values (?, ?, ?)`,
  ).run(TEST_USER_ID, `${TEST_USER_ID}@local`, 'system:no-login');
  db.prepare(
    `insert into user_videos (id, userId, displayName, originalFilename, s3Bucket, s3Key, status, transcript)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    TEST_VIDEO_ID,
    TEST_USER_ID,
    'fixture.mp4',
    'fixture.mp4',
    'bucket',
    'key',
    'ready',
    JSON.stringify({ language: 'en', duration: 1, words: [{ word: 'hello', start: 0, end: 0.5, confidence: 0.9 }] }),
  );
});

afterAll(() => {
  db.prepare(`delete from user_videos where id = ?`).run(TEST_VIDEO_ID);
  db.prepare(`delete from users where id = ?`).run(TEST_USER_ID);
});

describe('GET /uploads/:id row → view', () => {
  it('exposes the transcript field', async () => {
    const { buildUserVideoView } = await import('./uploadView.js');
    const row = db
      .prepare(`select * from user_videos where id = ?`)
      .get(TEST_VIDEO_ID) as Record<string, unknown>;
    const view = buildUserVideoView(row);
    expect(view.transcript).toBeDefined();
    expect((view.transcript as { language: string }).language).toBe('en');
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails.**

```bash
npm test -- src/api/uploadsGet.spec.ts
```

Expected: FAIL (`uploadView.js` not found).

- [ ] **Step 4: Extract the view-builder into a new helper.**

Create `src/api/uploadView.ts`:

```ts
// Row → API view for user_videos. Kept in its own module so the
// /uploads/:id handler and any other caller (e.g. /uploads list) share
// one place where the JSON contract is defined.
import type { Transcript } from '../shared/types.js';

type UserVideoRow = {
  id: string;
  userId: string;
  displayName: string;
  originalFilename: string;
  s3Bucket: string;
  s3Key: string;
  sizeBytes: number | null;
  durationSec: number | null;
  mimeType: string | null;
  status: string;
  widthPx: number | null;
  heightPx: number | null;
  transcript: string | null;
  createdAt: string;
  updatedAt: string;
};

export function buildUserVideoView(row: unknown): {
  id: string;
  displayName: string;
  originalFilename: string;
  status: string;
  sizeBytes: number | null;
  durationSec: number | null;
  mimeType: string | null;
  widthPx: number | null;
  heightPx: number | null;
  transcript: Transcript | null;
  createdAt: string;
} {
  const r = row as UserVideoRow;
  return {
    id: r.id,
    displayName: r.displayName,
    originalFilename: r.originalFilename,
    status: r.status,
    sizeBytes: r.sizeBytes,
    durationSec: r.durationSec,
    mimeType: r.mimeType,
    widthPx: r.widthPx,
    heightPx: r.heightPx,
    transcript: r.transcript ? (JSON.parse(r.transcript) as Transcript) : null,
    createdAt: r.createdAt,
  };
}
```

- [ ] **Step 5: Re-run the test.**

```bash
npm test -- src/api/uploadsGet.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Wire the helper into the existing `GET /uploads/:id` handler.**

Open `src/api/server.ts`, find the existing `app.get('/uploads/:id', ...)` handler. Replace its inline view-construction with `buildUserVideoView(row)`. Also update the `GET /uploads` list handler to use the same builder. Make sure to add `import { buildUserVideoView } from './uploadView.js';` near the other imports.

If either handler currently builds the view inline with different fields than the helper, reconcile: the helper is canonical.

- [ ] **Step 7: Smoke-test the live endpoint.**

With the API running and a test_agent_key cookie:

```bash
KEY="<TEST_AGENT_KEY>"; curl -s -H "x-admin-key: $KEY" http://localhost:5173/uploads | head -100
```

Expected: each row in the response array has a `transcript` field (likely `null` for existing rows).

- [ ] **Step 8: Commit.**

```bash
git add src/api/uploadView.ts src/api/server.ts src/api/uploadsGet.spec.ts
git commit -m "api: expose user_videos.transcript in upload views"
```

---

## Task 3: Python sidecar — FastAPI server holding `large-v3` warm

**Files:**
- Create: `transcribe-py/server.py`
- Modify: `transcribe-py/requirements-cpu.txt`
- Modify: `package.json` (add `npm run sidecar` script)

- [ ] **Step 1: Add FastAPI + uvicorn to the Python deps.**

Open `transcribe-py/requirements-cpu.txt`. Append:

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
python-multipart>=0.0.12
```

Then locally:

```bash
python3 -m venv .venv-sidecar
.venv-sidecar/bin/pip install -r transcribe-py/requirements-cpu.txt
```

(Skipping this is fine in the cloud build — Dockerfile picks the file up automatically. But for local dev you need the venv.)

- [ ] **Step 2: Write the sidecar.**

Create `transcribe-py/server.py`:

```python
"""FastAPI sidecar that holds faster-whisper large-v3 warm in memory.

Started alongside the Node API by scripts/start.sh (production) or
`npm run sidecar` (dev). Binds to 127.0.0.1:$WHISPER_PORT (default 8765)
and exposes a single POST /transcribe endpoint:

  body: {"path": "/tmp/foo.wav", "no_vad": false}
  200:  Transcript JSON (same shape as transcribe-py/transcribe.py emits)
  4xx:  {"error": "..."}

Concurrency: single-flight via asyncio.Lock. faster-whisper holds GIL
during inference, so processing two requests in parallel inside one
Python process gives no speedup — queueing is honest and predictable.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


def log(msg: str) -> None:
    print(f"[sidecar] {msg}", file=sys.stderr, flush=True)


_model = None
_align_model = None
_align_metadata = None
_lock = asyncio.Lock()


def _load_models() -> None:
    """Eagerly load Whisper + WhisperX align model at startup."""
    global _model, _align_model, _align_metadata
    import torch
    from faster_whisper import WhisperModel
    import whisperx

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    model_name = os.environ.get("WHISPER_MODEL", "large-v3")
    log(f"loading whisper {model_name} on {device} ({compute_type})...")
    _model = WhisperModel(model_name, device=device, compute_type=compute_type)
    log("whisper loaded")
    # Defer align model: it's English-only and many uploads aren't
    # English. Load on first need inside _run().


class TranscribeRequest(BaseModel):
    path: str
    no_vad: bool = False


app = FastAPI()


@app.on_event("startup")
def _startup() -> None:
    _load_models()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": _model is not None, "model": os.environ.get("WHISPER_MODEL", "large-v3")}


@app.post("/transcribe")
async def transcribe(req: TranscribeRequest) -> dict[str, Any]:
    if _model is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    if not os.path.exists(req.path):
        raise HTTPException(status_code=400, detail=f"path not found: {req.path}")

    async with _lock:
        log(f"transcribe start path={req.path} no_vad={req.no_vad}")
        try:
            return await asyncio.to_thread(_run, req.path, req.no_vad)
        except Exception as exc:
            log(f"transcribe failed: {exc!r}")
            raise HTTPException(status_code=500, detail=str(exc))


def _run(audio_path: str, no_vad: bool) -> dict[str, Any]:
    """Same transcribe semantics as transcribe-py/transcribe.py, minus
    the file-IO + subprocess hop. Returns a dict shaped exactly like the
    existing Transcript JSON contract."""
    assert _model is not None
    segments, info = _model.transcribe(
        audio_path,
        vad_filter=not no_vad,
        word_timestamps=True,
    )
    segments = list(segments)
    raw_words: list[dict[str, Any]] = []
    for seg in segments:
        if not seg.words:
            continue
        for w in seg.words:
            raw_words.append({
                "word": w.word.strip(),
                "start": float(w.start) if w.start is not None else 0.0,
                "end": float(w.end) if w.end is not None else 0.0,
                "confidence": float(w.probability) if w.probability is not None else 0.0,
            })

    # VAD retry parity with transcribe.py: if first pass had zero words and
    # we were running with VAD on, retry without VAD before giving up.
    if not raw_words and not no_vad:
        log("0-word pass with VAD on; retrying with no_vad=true")
        return _run(audio_path, no_vad=True)

    return {
        "language": info.language or "en",
        "duration": float(info.duration) if info.duration is not None else 0.0,
        "words": raw_words,
    }


def main() -> None:
    import uvicorn
    port = int(os.environ.get("WHISPER_PORT", "8765"))
    log(f"listening on 127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Add an npm script for dev.**

Open `package.json`. Add to `scripts`:

```json
"sidecar": "WHISPER_MODEL=${WHISPER_MODEL:-large-v3} /opt/venv/bin/python transcribe-py/server.py || python3 transcribe-py/server.py",
```

(The `||` falls back to a system Python when the Docker venv path isn't present, which lets devs run it locally after `pip install -r transcribe-py/requirements-cpu.txt`.)

- [ ] **Step 4: Smoke-test the sidecar.**

In a separate terminal:

```bash
npm run sidecar
```

Wait for `[sidecar] whisper loaded` (5–10s with a cached model, longer first time).

Then:

```bash
curl -s http://127.0.0.1:8765/health
```

Expected: `{"ok":true,"model":"large-v3"}`.

- [ ] **Step 5: Smoke-test inference with a fixture WAV.**

If you don't have a fixture WAV handy, generate one quickly:

```bash
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1" -ac 1 -ar 16000 /tmp/sine.wav
curl -s -X POST -H "content-type: application/json" \
  -d '{"path":"/tmp/sine.wav"}' http://127.0.0.1:8765/transcribe
```

Expected: JSON with `language`, `duration` ≈ 1.0, `words` (likely empty for pure sine).

For a more meaningful smoke test, point at any short voice clip on disk after ffmpeg-extracting its audio.

- [ ] **Step 6: Commit.**

```bash
git add transcribe-py/server.py transcribe-py/requirements-cpu.txt package.json
git commit -m "sidecar: FastAPI server holding faster-whisper large-v3 warm"
```

---

## Task 4: Node client for the sidecar

**Files:**
- Create: `src/transcribeSidecar.ts`
- Create: `src/transcribeSidecar.spec.ts`

- [ ] **Step 1: Write the failing test.**

Create `src/transcribeSidecar.spec.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { transcribeViaSidecar } from './transcribeSidecar.js';

let server: Server;
let port = 0;
const captured: { method: string; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      captured.push({ method: req.method ?? '', body });
      if (req.url === '/transcribe') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ language: 'en', duration: 0.5, words: [] }));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('transcribeViaSidecar', () => {
  it('POSTs path to /transcribe and returns Transcript', async () => {
    const result = await transcribeViaSidecar('/tmp/x.wav', { port });
    expect(result.language).toBe('en');
    expect(captured[0].method).toBe('POST');
    expect(JSON.parse(captured[0].body)).toEqual({
      path: '/tmp/x.wav',
      no_vad: false,
    });
  });

  it('forwards no_vad', async () => {
    captured.length = 0;
    await transcribeViaSidecar('/tmp/y.wav', { port, noVad: true });
    expect(JSON.parse(captured[0].body).no_vad).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm it fails.**

```bash
npm test -- src/transcribeSidecar.spec.ts
```

Expected: FAIL (`transcribeSidecar.js` not found).

- [ ] **Step 3: Implement the client.**

Create `src/transcribeSidecar.ts`:

```ts
import type { Transcript } from './shared/types.js';

// Calls the Python sidecar over localhost. Sidecar is started by
// scripts/start.sh (production) or `npm run sidecar` (dev) and binds to
// 127.0.0.1:$WHISPER_PORT (default 8765).
//
// The audio file must already be on the same filesystem the sidecar
// can see — we pass it by path, not bytes, so the API process and the
// sidecar share /tmp (or whatever STORAGE_DIR resolves to).

const DEFAULT_PORT = Number(process.env.WHISPER_PORT ?? 8765);
const DEFAULT_TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS ?? 5 * 60_000);

export async function transcribeViaSidecar(
  audioPath: string,
  opts: { port?: number; noVad?: boolean; timeoutMs?: number } = {},
): Promise<Transcript> {
  const port = opts.port ?? DEFAULT_PORT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: audioPath, no_vad: opts.noVad ?? false }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SidecarError(res.status, text || res.statusText);
    }
    return (await res.json()) as Transcript;
  } catch (err) {
    if (err instanceof SidecarError) throw err;
    if ((err as { name?: string }).name === 'AbortError') {
      throw new SidecarError(504, `sidecar timeout after ${timeoutMs}ms`);
    }
    throw new SidecarError(503, `sidecar unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function sidecarHealth(opts: { port?: number } = {}): Promise<boolean> {
  const port = opts.port ?? DEFAULT_PORT;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export class SidecarError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'SidecarError';
  }
}
```

- [ ] **Step 4: Re-run.**

```bash
npm test -- src/transcribeSidecar.spec.ts
```

Expected: PASS (both cases).

- [ ] **Step 5: Commit.**

```bash
git add src/transcribeSidecar.ts src/transcribeSidecar.spec.ts
git commit -m "sidecar: Node client with timeout + structured errors"
```

---

## Task 5: `POST /transcribe` endpoint (multipart fast-path)

**Files:**
- Modify: `src/api/server.ts`
- Test: `tests/integration/transcribe-endpoint.test.ts` (new)

- [ ] **Step 1: Write the failing integration test.**

Create `tests/integration/transcribe-endpoint.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/db.js';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const TEST_KEY = process.env.TEST_AGENT_KEY;

// Skip the whole suite when prerequisites aren't met instead of silently
// passing. The test needs (1) the API running with TEST_AGENT_KEY set,
// (2) the sidecar reachable on $WHISPER_PORT. vitest's describe.skipIf
// emits a "skipped" badge so CI doesn't get a false green.
const PREREQS_OK = Boolean(TEST_KEY);

const TEST_USER = `system:agent-test`; // pre-seeded by middleware boot
const TEST_VIDEO = `uv-test-${randomUUID().slice(0, 8)}`;

let workDir = '';
let fakeSidecar: ChildProcess | null = null;

beforeAll(async () => {
  if (!PREREQS_OK) return;
  workDir = mkdtempSync(join(tmpdir(), 'transcribe-int-'));

  // Insert a user_videos row we'll PATCH via the endpoint.
  db.prepare(
    `insert into user_videos (id, userId, displayName, originalFilename, s3Bucket, s3Key, status)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(TEST_VIDEO, TEST_USER, 'fixture.mp4', 'fixture.mp4', 'bucket', 'key', 'pending');

  // Fake sidecar on a non-default port. server.ts reads WHISPER_PORT each
  // request — verify your endpoint passes the port through, OR start the
  // API with WHISPER_PORT=$fakePort set before running this test.
  // For now: presume the API was started with WHISPER_PORT pointing at our fake.
  // Skip this test if not.
  const probe = await fetch(`${API_BASE}/health`, { headers: { 'x-admin-key': TEST_KEY } }).catch(() => null);
  if (!probe) throw new Error(`API not reachable at ${API_BASE} — start it before running this test`);
});

afterAll(() => {
  if (fakeSidecar) fakeSidecar.kill();
  rmSync(workDir, { recursive: true, force: true });
  db.prepare(`delete from user_videos where id = ?`).run(TEST_VIDEO);
});

describe.skipIf(!PREREQS_OK)('POST /transcribe', () => {
  it('accepts a WAV upload, calls the sidecar, and PATCHes user_videos.transcript', async () => {
    const wavPath = join(workDir, 'sine.wav');
    // 0.1s of silence — small enough to ship in the test.
    const sr = 16000;
    const samples = sr / 10;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + samples * 2, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sr, 24);
    header.writeUInt32LE(sr * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(samples * 2, 40);
    const data = Buffer.alloc(samples * 2);
    writeFileSync(wavPath, Buffer.concat([header, data]));

    const form = new FormData();
    form.append('audio', new Blob([Buffer.concat([header, data])], { type: 'audio/wav' }), 'sine.wav');
    form.append('userVideoId', TEST_VIDEO);

    const res = await fetch(`${API_BASE}/transcribe`, {
      method: 'POST',
      headers: { 'x-admin-key': TEST_KEY! },
      body: form,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { language?: string; words?: unknown[] };
    expect(body.language).toBeTruthy();
    expect(Array.isArray(body.words)).toBe(true);

    const row = db
      .prepare(`select transcript from user_videos where id = ?`)
      .get(TEST_VIDEO) as { transcript: string | null };
    expect(row.transcript).not.toBeNull();
    expect(JSON.parse(row.transcript!).language).toBe(body.language);
  });
});
```

- [ ] **Step 2: Run to confirm it fails.**

```bash
npm test -- tests/integration/transcribe-endpoint.test.ts
```

Expected: FAIL (endpoint 404s, or fetch fails because API isn't running, or no TEST_AGENT_KEY).

This integration test requires the API to be running with `TEST_AGENT_KEY` set AND a working sidecar (or a fake one). Document the prerequisite in the test header comment and treat the failure mode as expected when those aren't satisfied; the next step makes the endpoint exist so the assertion paths exercise.

- [ ] **Step 3: Implement the endpoint.**

Open `src/api/server.ts`. Near the other upload handlers (around line 2100), add:

```ts
// Fast-path transcribe. Browser sends a 16kHz mono WAV via multipart;
// we hand it off to the warm Python sidecar and (if userVideoId is
// provided) PATCH user_videos.transcript so the next /uploads/:id
// returns it inline. This endpoint is what unblocks the designer
// mount — it does NOT mint a job, does NOT trigger any render.
app.post('/transcribe', { preHandler: requireAuth }, async (req, reply) => {
  // Read the first file part. @fastify/multipart is already registered
  // (see the existing /uploads handler). Cap audio at 25 MB — the
  // largest plausible 16kHz mono WAV for a 3-minute clip is ~6 MB; 25
  // gives plenty of headroom for stereo/48k oversize inputs while
  // still bounding memory.
  const parts = req.parts();
  let audioPath: string | null = null;
  let userVideoId: string | null = null;
  const tmpFile = join(STORAGE_DIR, 'work', `transcribe-${randomUUID()}.wav`);
  await mkdir(join(STORAGE_DIR, 'work'), { recursive: true });

  try {
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'audio') {
        await pipeline(part.file, createWriteStream(tmpFile));
        audioPath = tmpFile;
        if (part.file.truncated) {
          return reply.code(413).send({ error: 'audio exceeded 25MB limit' });
        }
      } else if (part.type === 'field' && part.fieldname === 'userVideoId') {
        userVideoId = String(part.value);
      }
    }
    if (!audioPath) return reply.code(400).send({ error: 'audio file part required' });

    // Validate ownership before calling sidecar (cheap, fails fast).
    if (userVideoId) {
      const uv = selectUserVideoForUser.get(userVideoId, req.user!.id);
      if (!uv) return reply.code(404).send({ error: 'user_video not found' });
    }

    const transcript = await transcribeViaSidecar(audioPath);

    if (userVideoId) {
      db.prepare(
        `update user_videos set transcript = ?, updatedAt = datetime('now') where id = ? and userId = ?`,
      ).run(JSON.stringify(transcript), userVideoId, req.user!.id);
    }

    return transcript;
  } catch (err) {
    if (err instanceof SidecarError) {
      return reply.code(err.status === 504 ? 504 : 503).send({ error: err.message });
    }
    req.log.error({ err }, 'POST /transcribe failed');
    return reply.code(500).send({ error: (err as Error).message });
  } finally {
    rm(tmpFile, { force: true }).catch(() => undefined);
  }
});
```

Add the required imports at the top of the file if not already present:

```ts
import { transcribeViaSidecar, SidecarError } from '../transcribeSidecar.js';
```

`createWriteStream`, `pipeline`, `mkdir`, `rm`, `randomUUID`, `STORAGE_DIR`, and `selectUserVideoForUser` should already be in scope from the existing handlers — check before re-importing.

- [ ] **Step 4: Re-run with API + sidecar running.**

In one terminal: `npm run sidecar` (wait for `whisper loaded`).
In another: `npm run api`.
In a third:

```bash
npm test -- tests/integration/transcribe-endpoint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Live smoke test through the running API.**

```bash
KEY="<TEST_AGENT_KEY>"
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1" -ac 1 -ar 16000 /tmp/sine.wav
curl -s -X POST -H "x-admin-key: $KEY" -F "audio=@/tmp/sine.wav" http://localhost:5173/transcribe | head -20
```

Expected: a JSON transcript (likely with empty `words` for pure sine, but `language` + `duration` populated).

- [ ] **Step 6: Commit.**

```bash
git add src/api/server.ts tests/integration/transcribe-endpoint.test.ts
git commit -m "api: POST /transcribe (multipart audio → sidecar → user_videos.transcript)"
```

---

## Task 6: `POST /transcribe-from-upload` (server-extract fallback)

**Files:**
- Modify: `src/api/server.ts`

- [ ] **Step 1: Add the fallback endpoint right after `/transcribe`.**

In `src/api/server.ts`, add:

```ts
// Fallback for browsers that can't run ffmpeg.wasm (oversize input, codec
// rejection, mobile). Takes a userVideoId, fetches a presigned GET URL for
// the S3 object, runs `ffmpeg -i <url> -vn -ar 16000 -ac 1 wav` locally to
// extract audio packets via Range requests (no full download), then hands
// the WAV to the sidecar. Same response shape as /transcribe.
app.post('/transcribe-from-upload', { preHandler: requireAuth }, async (req, reply) => {
  const body = req.body as { userVideoId?: unknown } | null;
  const userVideoId = body && typeof body.userVideoId === 'string' ? body.userVideoId : null;
  if (!userVideoId) return reply.code(400).send({ error: 'userVideoId required' });

  const uv = selectUserVideoForUser.get(userVideoId, req.user!.id) as
    | { id: string; s3Bucket: string; s3Key: string }
    | undefined;
  if (!uv) return reply.code(404).send({ error: 'user_video not found' });

  const sourceUrl = await presignDownloadUrl(uv.s3Bucket, uv.s3Key);
  const tmpFile = join(STORAGE_DIR, 'work', `transcribe-${randomUUID()}.wav`);
  await mkdir(join(STORAGE_DIR, 'work'), { recursive: true });

  try {
    await runFfmpegAudio(sourceUrl, tmpFile);
    const transcript = await transcribeViaSidecar(tmpFile);
    db.prepare(
      `update user_videos set transcript = ?, updatedAt = datetime('now') where id = ? and userId = ?`,
    ).run(JSON.stringify(transcript), userVideoId, req.user!.id);
    return transcript;
  } catch (err) {
    if (err instanceof SidecarError) {
      return reply.code(err.status === 504 ? 504 : 503).send({ error: err.message });
    }
    req.log.error({ err }, 'POST /transcribe-from-upload failed');
    return reply.code(500).send({ error: (err as Error).message });
  } finally {
    rm(tmpFile, { force: true }).catch(() => undefined);
  }
});

function runFfmpegAudio(source: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', source,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      outPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-500)}`));
    });
  });
}
```

You'll also need to ensure `presignDownloadUrl` (or whatever the existing presigning helper is called — check `src/lib/s3Outputs.ts`) is imported. If a presigned GET helper doesn't exist yet, add one alongside the existing `presignPutUrl`:

```ts
// In src/lib/s3Outputs.ts
export async function presignDownloadUrl(bucket: string, key: string): Promise<string> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const s3 = new S3Client({ region });
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
}
```

If `presignDownloadUrl` already exists, use it. Search first:

```bash
grep -n "presignDownloadUrl\|getSignedUrl.*GetObjectCommand" src/lib/s3Outputs.ts
```

- [ ] **Step 2: Live smoke test.**

Find a userVideoId that has been uploaded:

```bash
KEY="<TEST_AGENT_KEY>"
UV_ID=$(curl -s -H "x-admin-key: $KEY" http://localhost:5173/uploads | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')
curl -s -X POST -H "x-admin-key: $KEY" -H "content-type: application/json" \
  -d "{\"userVideoId\":\"$UV_ID\"}" http://localhost:5173/transcribe-from-upload | head -20
```

Expected: a Transcript JSON. (If no uploads exist, upload one first via the normal UI.)

- [ ] **Step 3: Verify the user_videos row was PATCHed.**

```bash
sqlite3 storage/captions.db "SELECT id, transcript IS NOT NULL FROM user_videos WHERE id = '$UV_ID';"
```

Expected: `1`.

- [ ] **Step 4: Commit.**

```bash
git add src/api/server.ts src/lib/s3Outputs.ts
git commit -m "api: POST /transcribe-from-upload fallback for browser-decode failures"
```

---

## Task 7: `useEditableSource` — add `'upload'` kind

**Files:**
- Modify: `web/src/lib/useEditableSource.ts`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Extend the `getUpload` return type.**

Open `web/src/lib/api.ts`. Find the existing `getUpload` function and the `UserVideo` type. Add `transcript: Transcript | null` to `UserVideo` (import `Transcript` from `@shared/types` if not already present — check the existing imports).

- [ ] **Step 2: Add the upload branch to `useEditableSource`.**

Open `web/src/lib/useEditableSource.ts`. Update `EditorSource` to include the new kind:

```ts
export type EditorSource =
  | { kind: 'job'; jobId: string }
  | { kind: 'stock'; clipId: string }
  | { kind: 'theme'; themeId: string }
  | { kind: 'upload'; userVideoId: string };
```

In `sourceKeyOf`, add:

```ts
case 'upload':
  return `upload:${source.userVideoId}`;
```

In the effect body, between the `stock` branch and the `theme` branch, add:

```ts
if (current.kind === 'upload') {
  const tryLoad = async () => {
    const uv = await getUpload(current.userVideoId);
    if (cancelled) return;
    if (uv.transcript) {
      // Build a usable presigned URL for the preview. The server already
      // exposes user_videos via a redirect-to-presigned-URL endpoint;
      // re-use whatever the existing flow uses (check api.ts for the
      // download/preview URL helper — likely `/uploads/:id/source`).
      finishWith({
        transcript: uv.transcript,
        captionPlan: null,
        videoSrc: `/uploads/${current.userVideoId}/source`,
        durationSec: uv.transcript.duration ?? uv.durationSec ?? 0,
        inputAvailable: true,
        status: 'done',
        initialTemplateId: 'reel-clone',
        initialStyleSpec: {},
        outputUrl: null,
        widthPx: uv.widthPx ?? null,
        heightPx: uv.heightPx ?? null,
      });
      return;
    }
    // Transcript not yet ready — short-poll. /transcribe finishes async
    // from /uploads/init, so this branch covers the page-refresh case
    // where we land on the editor before /transcribe has returned.
    timer = setTimeout(tryLoad, 1000);
  };
  tryLoad().catch(failWith);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
```

If `/uploads/:id/source` doesn't exist yet, check `src/api/server.ts` for the actual route name (likely `/uploads/:id/download` or similar). The shape of the URL just needs to resolve to a playable video for the preview.

- [ ] **Step 3: Allow `'upload'` as a `sourceKind` in `POST /designer/sessions`.**

Open `src/api/server.ts`, find the validator at line ~1125:

```ts
if (sourceKind !== 'stock' && sourceKind !== 'job') {
  return reply.code(400).send({ error: 'sourceKind must be "stock" or "job"' });
}
```

Replace with:

```ts
if (sourceKind !== 'stock' && sourceKind !== 'job' && sourceKind !== 'upload') {
  return reply.code(400).send({ error: 'sourceKind must be "stock", "job", or "upload"' });
}
```

Also grep for any other place this constraint is enforced (TypeScript types in the row reader, etc.) and widen:

```bash
grep -n "'stock' | 'job'\|sourceKind.*stock.*job" src/api/server.ts
```

Update each hit.

- [ ] **Step 4: Manual verification.**

This change can't be unit-tested without web test infra. Verify manually after Task 11 lands. For now, run typecheck:

```bash
cd web && npx tsc -b --noEmit
cd ..
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Smoke-test the server-side change directly.**

```bash
KEY="<TEST_AGENT_KEY>"
curl -s -w "\nHTTP %{http_code}\n" -H "x-admin-key: $KEY" -H "content-type: application/json" \
  -X POST http://localhost:5173/designer/sessions \
  -d '{"templateId":"reel-clone","sourceKind":"upload","sourceId":"fake-uv-id","styleSpec":{},"firstMessage":"x","messages":[]}'
```

Expected: 200 OK (a session row is created with sourceKind='upload'; clean up afterward with `sqlite3 storage/captions.db "DELETE FROM designer_sessions WHERE sourceId='fake-uv-id';"`).

- [ ] **Step 6: Commit.**

```bash
git add web/src/lib/useEditableSource.ts web/src/lib/api.ts src/api/server.ts
git commit -m "sessions: allow 'upload' sourceKind; useEditableSource resolves uploads inline"
```

---

## Task 8: `ffmpeg.wasm` extractor — add dep, lazy-load wrapper

**Files:**
- Modify: `web/package.json`
- Create: `web/src/lib/extractAudio.ts`

- [ ] **Step 1: Install the deps.**

```bash
cd web && npm install @ffmpeg/ffmpeg@^0.12 @ffmpeg/util@^0.12
cd ..
```

(@ffmpeg/ffmpeg 0.12.x uses worker + WASM split — `@ffmpeg/util` provides `fetchFile` and helpers.)

- [ ] **Step 2: Write the extractor.**

Create `web/src/lib/extractAudio.ts`:

```ts
import type { FFmpeg } from '@ffmpeg/ffmpeg';

// Lazy-loaded singleton: ffmpeg.wasm is ~25 MB compressed. We load it
// on first file-pick, not at app boot. The browser caches the worker
// + WASM after first load.
let _ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg(): Promise<FFmpeg> {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ff = new FFmpeg();
    // Pin to the exact 0.12 release jsDelivr serves so the worker JS
    // matches the WASM blob and the wrapper. Versions drift between
    // packages — explicit URLs prevent the cross-version mismatch
    // people hit with the unversioned CDN paths.
    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    await ff.load({
      coreURL: `${base}/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg-core.wasm`,
    });
    return ff;
  })();
  return _ffmpegPromise;
}

export type ExtractAudioResult = {
  blob: Blob;
  durationSec: number;
};

// Extract a 16kHz mono PCM WAV from any video the browser's ffmpeg.wasm
// can demux. Returns the WAV as a Blob, ready for multipart upload.
//
// Throws on:
//   - file too large (>500MB heuristic)
//   - ffmpeg fails to demux (typically a corrupt or unsupported codec)
// Callers should catch these and fall back to /transcribe-from-upload.
export async function extractAudio(file: File): Promise<ExtractAudioResult> {
  if (file.size > 500 * 1024 * 1024) {
    throw new ExtractAudioError('file too large for browser decode', 'oversize');
  }

  const ff = await getFfmpeg();
  const { fetchFile } = await import('@ffmpeg/util');
  const inName = 'input.mp4'; // ffmpeg uses extension for demux hints
  const outName = 'out.wav';

  await ff.writeFile(inName, await fetchFile(file));
  const code = await ff.exec([
    '-i', inName,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    outName,
  ]);
  if (code !== 0) {
    throw new ExtractAudioError('ffmpeg.wasm failed to decode', 'decode');
  }

  const data = (await ff.readFile(outName)) as Uint8Array;
  await ff.deleteFile(inName);
  await ff.deleteFile(outName);

  // PCM s16 mono 16kHz: 32000 bytes/s of payload + 44-byte WAV header.
  const durationSec = Math.max(0, (data.byteLength - 44) / 32000);
  return {
    blob: new Blob([data], { type: 'audio/wav' }),
    durationSec,
  };
}

export class ExtractAudioError extends Error {
  reason: 'oversize' | 'decode';
  constructor(message: string, reason: 'oversize' | 'decode') {
    super(message);
    this.reason = reason;
    this.name = 'ExtractAudioError';
  }
}
```

- [ ] **Step 3: Typecheck.**

```bash
cd web && npx tsc -b --noEmit
cd ..
```

Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add web/package.json web/package-lock.json package-lock.json web/src/lib/extractAudio.ts
git commit -m "web: extractAudio wrapper around lazy-loaded ffmpeg.wasm"
```

---

## Task 9: Pure orchestrator (`runFastUpload`) + tests

**Files:**
- Create: `src/shared/fastUpload.ts`
- Create: `src/shared/fastUpload.spec.ts`
- Modify: `web/tsconfig.json`

- [ ] **Step 1: Add the alias entry.**

Open `web/tsconfig.json`. In the `paths` block, add:

```json
"@shared/fastUpload": ["../src/shared/fastUpload.ts"],
```

Also update `web/vite.config.ts` `resolve.alias` to match if the alias config is duplicated there (check first; existing `@shared/*` entries may already cover this pattern via a wildcard).

- [ ] **Step 2: Write the failing test.**

Create `src/shared/fastUpload.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runFastUpload, type FastUploadApi } from './fastUpload.js';

function makeFile(name = 'clip.mp4', size = 100): File {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4' });
}

function makeApi(overrides: Partial<FastUploadApi> = {}): FastUploadApi {
  return {
    init: vi.fn(async () => ({ userVideoId: 'uv-1', putUrl: 'https://s3/put' })),
    transcribe: vi.fn(async () => ({ language: 'en', duration: 1, words: [] })),
    putS3: vi.fn(async () => undefined),
    finalize: vi.fn(async () => undefined),
    extractAudio: vi.fn(async () => ({ blob: new Blob(['x']), durationSec: 1 })),
    ...overrides,
  };
}

describe('runFastUpload', () => {
  it('mints userVideoId before transcribe + S3 PUT fire', async () => {
    const order: string[] = [];
    const api = makeApi({
      init: vi.fn(async () => {
        order.push('init');
        return { userVideoId: 'uv-1', putUrl: 'https://s3' };
      }),
      transcribe: vi.fn(async () => {
        order.push('transcribe');
        return { language: 'en', duration: 1, words: [] };
      }),
      putS3: vi.fn(async () => {
        order.push('putS3');
      }),
      finalize: vi.fn(async () => {
        order.push('finalize');
      }),
    });
    await runFastUpload({ file: makeFile(), api });
    expect(order[0]).toBe('init');
    // transcribe + putS3 race; both must come after init and before finalize
    expect(order.slice(1, 3).sort()).toEqual(['putS3', 'transcribe']);
    expect(order[3]).toBe('finalize');
  });

  it('returns userVideoId and transcript before finalize completes (designer can mount early)', async () => {
    let finalizeResolve!: () => void;
    const api = makeApi({
      finalize: () =>
        new Promise<void>((r) => {
          finalizeResolve = r;
        }),
    });
    const promise = runFastUpload({ file: makeFile(), api });
    // The early result is delivered via the onTranscriptReady callback,
    // not the final return value.
    const onTranscriptReady = vi.fn();
    const fullPromise = runFastUpload({ file: makeFile(), api, onTranscriptReady });
    // give microtasks a chance to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(onTranscriptReady).toHaveBeenCalled();
    finalizeResolve();
    await fullPromise;
    void promise; // suppress unused warning
  });

  it('falls back to transcribeFromUpload when extractAudio throws oversize', async () => {
    const tfu = vi.fn(async () => ({ language: 'en', duration: 1, words: [] }));
    const api = makeApi({
      extractAudio: vi.fn(async () => {
        throw new Error('oversize');
      }),
      transcribe: vi.fn(async () => {
        throw new Error('should not be called');
      }),
      transcribeFromUpload: tfu,
    });
    const result = await runFastUpload({ file: makeFile(), api });
    expect(tfu).toHaveBeenCalledWith('uv-1');
    expect(result.transcript.language).toBe('en');
  });
});
```

- [ ] **Step 3: Run to confirm it fails.**

```bash
npm test -- src/shared/fastUpload.spec.ts
```

Expected: FAIL (`fastUpload.js` not found).

- [ ] **Step 4: Implement.**

Create `src/shared/fastUpload.ts`:

```ts
import type { Transcript } from './types.js';

// Pure orchestrator for the browser fast-path. All side-effecting work
// is injected via the `api` parameter so this module is testable in
// Node with vitest (no jsdom, no real network, no ffmpeg.wasm).
//
// Flow:
//   1. POST /uploads/init                         -> userVideoId + putUrl
//   2. extractAudio(file)                         -> WAV blob (browser-side)
//   3. parallel:
//      a) POST /transcribe (audio, userVideoId)   -> Transcript
//      b) PUT putUrl, body=file                   -> S3
//   4. POST /uploads/:id/finalize                 -> mark ready
//
// On extractAudio failure with reason='oversize' or 'decode', we fall
// back to: complete the S3 PUT first, then POST /transcribe-from-upload.

export type FastUploadApi = {
  init: (input: { filename: string; sizeBytes: number; mimeType: string }) =>
    Promise<{ userVideoId: string; putUrl: string }>;
  extractAudio: (file: File) => Promise<{ blob: Blob; durationSec: number }>;
  transcribe: (input: { audio: Blob; userVideoId: string }) => Promise<Transcript>;
  transcribeFromUpload?: (userVideoId: string) => Promise<Transcript>;
  putS3: (input: { url: string; file: File; onProgress?: (loaded: number, total: number) => void }) => Promise<void>;
  finalize: (input: { userVideoId: string }) => Promise<void>;
};

export type FastUploadResult = {
  userVideoId: string;
  transcript: Transcript;
  uploadCompleted: boolean;
};

export type FastUploadHandlers = {
  onTranscriptReady?: (input: { userVideoId: string; transcript: Transcript }) => void;
  onUploadProgress?: (loaded: number, total: number) => void;
  onFallback?: (reason: string) => void;
};

export async function runFastUpload(args: {
  file: File;
  api: FastUploadApi;
} & FastUploadHandlers): Promise<FastUploadResult> {
  const { file, api, onTranscriptReady, onUploadProgress, onFallback } = args;

  const { userVideoId, putUrl } = await api.init({
    filename: file.name,
    sizeBytes: file.size,
    mimeType: file.type || 'video/mp4',
  });

  // Try the fast path: extract audio in browser, parallel-fire
  // transcribe + S3 PUT. If extractAudio rejects, fall back below.
  let audio: { blob: Blob; durationSec: number } | null = null;
  try {
    audio = await api.extractAudio(file);
  } catch (err) {
    onFallback?.((err as Error).message);
  }

  if (audio) {
    const transcribePromise = api
      .transcribe({ audio: audio.blob, userVideoId })
      .then((t) => {
        onTranscriptReady?.({ userVideoId, transcript: t });
        return t;
      });
    const uploadPromise = api.putS3({
      url: putUrl,
      file,
      onProgress: onUploadProgress,
    });
    const [transcript] = await Promise.all([transcribePromise, uploadPromise]);
    await api.finalize({ userVideoId });
    return { userVideoId, transcript, uploadCompleted: true };
  }

  // Fallback path: video must reach S3 before the server can extract audio
  // from it. Slower but reliable for codecs/sizes ffmpeg.wasm can't handle.
  if (!api.transcribeFromUpload) {
    throw new Error('browser audio extraction failed and no fallback configured');
  }
  await api.putS3({ url: putUrl, file, onProgress: onUploadProgress });
  await api.finalize({ userVideoId });
  const transcript = await api.transcribeFromUpload(userVideoId);
  onTranscriptReady?.({ userVideoId, transcript });
  return { userVideoId, transcript, uploadCompleted: true };
}
```

- [ ] **Step 5: Re-run.**

```bash
npm test -- src/shared/fastUpload.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/shared/fastUpload.ts src/shared/fastUpload.spec.ts web/tsconfig.json
git commit -m "shared: pure fast-upload orchestrator with transcribe/PUT race"
```

---

## Task 10: React hook (`useFastUpload`) over the orchestrator

**Files:**
- Modify: `web/src/lib/api.ts` (add postTranscribe, postTranscribeFromUpload helpers)
- Create: `web/src/lib/useFastUpload.ts`

- [ ] **Step 1: Add the API helpers.**

Open `web/src/lib/api.ts`. Add (near other upload-related fns):

```ts
export async function postTranscribe(input: {
  audio: Blob;
  userVideoId: string;
}): Promise<Transcript> {
  const form = new FormData();
  form.append('audio', input.audio, 'audio.wav');
  form.append('userVideoId', input.userVideoId);
  const r = await api('/transcribe', { method: 'POST', body: form });
  if (!r.ok) throw new Error(`POST /transcribe ${r.status}`);
  return r.json();
}

export async function postTranscribeFromUpload(userVideoId: string): Promise<Transcript> {
  const r = await api('/transcribe-from-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userVideoId }),
  });
  if (!r.ok) throw new Error(`POST /transcribe-from-upload ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Write the hook.**

Create `web/src/lib/useFastUpload.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import {
  runFastUpload,
  type FastUploadApi,
} from '@shared/fastUpload';
import { extractAudio, ExtractAudioError } from './extractAudio';
import {
  initUpload,
  finalizeUpload,
  postTranscribe,
  postTranscribeFromUpload,
} from './api';

// Browser-side counterpart to runFastUpload: wires the orchestrator's
// abstract `api` to real fetch calls and exposes React state.
//
// Returns a `start(file)` action plus the latest state. start() resolves
// to { userVideoId, transcript } as soon as both init and transcribe
// have returned; the S3 PUT may still be in flight (uploadCompleted
// flag tracks that).

export type FastUploadState =
  | { phase: 'idle' }
  | { phase: 'extracting' }
  | { phase: 'transcribing'; userVideoId: string; uploadPct: number }
  | { phase: 'ready'; userVideoId: string; uploadPct: number; uploadCompleted: boolean }
  | { phase: 'error'; message: string };

export function useFastUpload() {
  const [state, setState] = useState<FastUploadState>({ phase: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const start = useCallback(
    async (file: File) => {
      setState({ phase: 'extracting' });
      let uploadPct = 0;

      const api: FastUploadApi = {
        init: async (input) => {
          const r = await initUpload(input);
          return { userVideoId: r.userVideoId, putUrl: r.putUrl };
        },
        extractAudio: async (f) => {
          try {
            return await extractAudio(f);
          } catch (err) {
            if (err instanceof ExtractAudioError) throw err;
            throw new ExtractAudioError((err as Error).message, 'decode');
          }
        },
        transcribe: postTranscribe,
        transcribeFromUpload: postTranscribeFromUpload,
        putS3: ({ url, file, onProgress }) =>
          new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) onProgress?.(e.loaded, e.total);
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else reject(new Error(`S3 PUT ${xhr.status}`));
            };
            xhr.onerror = () => reject(new Error('S3 PUT network error'));
            xhr.send(file);
          }),
        finalize: async ({ userVideoId }) => {
          await finalizeUpload(userVideoId);
        },
      };

      try {
        const result = await runFastUpload({
          file,
          api,
          onTranscriptReady: ({ userVideoId, transcript }) => {
            setState({ phase: 'transcribing', userVideoId, uploadPct });
            // store for caller
            transcriptResolveRef.current?.({ userVideoId, transcript });
          },
          onUploadProgress: (loaded, total) => {
            uploadPct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            const cur = stateRef.current;
            if (cur.phase === 'transcribing' || cur.phase === 'ready') {
              setState({ ...cur, uploadPct });
            }
          },
        });
        setState({
          phase: 'ready',
          userVideoId: result.userVideoId,
          uploadPct: 100,
          uploadCompleted: result.uploadCompleted,
        });
        return result;
      } catch (err) {
        setState({ phase: 'error', message: (err as Error).message });
        throw err;
      }
    },
    [],
  );

  // The "ready as soon as transcript arrives" promise — separate from
  // start() so the page can swap to the designer the moment the
  // transcript lands without waiting for finalize.
  const transcriptResolveRef = useRef<
    ((value: { userVideoId: string; transcript: import('@/lib/api').Transcript }) => void) | null
  >(null);
  const earlyTranscript = useCallback(
    () =>
      new Promise<{ userVideoId: string; transcript: import('@/lib/api').Transcript }>((resolve) => {
        transcriptResolveRef.current = resolve;
      }),
    [],
  );

  return { state, start, earlyTranscript };
}
```

You'll need to verify `initUpload` and `finalizeUpload` exist in `web/src/lib/api.ts` with the right shapes (`initUpload` should return `{ userVideoId, putUrl }`; `finalizeUpload` takes a userVideoId). If they're named differently, rename accordingly — search first:

```bash
grep -n "initUpload\|finalizeUpload\|/uploads/init\|/uploads/.*finalize" web/src/lib/api.ts
```

- [ ] **Step 3: Typecheck.**

```bash
cd web && npx tsc -b --noEmit
cd ..
```

Expected: no errors. If there are, the most likely cause is a mismatch between this hook's assumed names and what `api.ts` actually exports — reconcile.

- [ ] **Step 4: Commit.**

```bash
git add web/src/lib/api.ts web/src/lib/useFastUpload.ts
git commit -m "web: useFastUpload hook wraps shared orchestrator with progress state"
```

---

## Task 11: Wire `StartPage` Generate to the fast path

**Files:**
- Modify: `web/src/pages/start/StartPage.tsx`

- [ ] **Step 1: Read the current flow.**

The relevant section is `SubmittingHandoff` at the bottom of the file. The current upload branch calls `createJobFromUpload` and waits for `resolved`. We're swapping that branch (and only that branch) for `useFastUpload`. The stock branch stays exactly as it is.

- [ ] **Step 2: Refactor `SubmittingHandoff`.**

Replace the upload branch's job-creation effect with `useFastUpload`, and add a new resolved shape:

```tsx
import { useFastUpload } from '@/lib/useFastUpload';

// ... inside SubmittingHandoff:

const [resolved, setResolved] = useState<
  | { kind: 'stock'; clipId: string }
  | { kind: 'upload'; userVideoId: string }
  | null
>(starter.sourceKind === 'stock' ? { kind: 'stock', clipId: starter.id } : null);

const fast = useFastUpload();
useEffect(() => {
  if (resolved || starter.sourceKind !== 'upload') return;
  let cancelled = false;
  const abort = new AbortController();
  // We need the actual File for fast upload. SubmittingHandoff was only
  // given a CuratedStarter (id/filename/durationSec); the File object
  // lives in the parent StartPage's upload helper. Pass it through via
  // an additional prop (see edit to the call site below).
  if (!fileForUpload) return;
  fast.start(fileForUpload)
    .then(({ userVideoId }) => {
      if (!cancelled) setResolved({ kind: 'upload', userVideoId });
    })
    .catch((err) => {
      if (!cancelled) onError(err);
    });
  return () => {
    cancelled = true;
    abort.abort();
  };
}, [starter, resolved, fileForUpload, fast, onError]);

const editorSource: EditorSource | null = useMemo(() => {
  if (!resolved) return null;
  if (resolved.kind === 'stock') return { kind: 'stock', clipId: resolved.clipId };
  return { kind: 'upload', userVideoId: resolved.userVideoId };
}, [resolved]);
```

- [ ] **Step 3: Plumb the `File` through.**

`SubmittingHandoff` is called by `StartPage` with `starter`. The actual `File` object is held by `useUploadVideo()`'s `upload.staged` state. Pass it through:

In `StartPage`:

```tsx
{submitted && (
  <SubmittingHandoff
    text={submitted.text}
    starter={submitted.starter}
    fileForUpload={upload.staged ?? null}
    onError={...}
    navigate={navigate}
  />
)}
```

Update the component signature accordingly.

Also: the current `StartPage.onSubmit` (line 230 area) calls `upload.run()` for upload starters, which performs the *old* upload path. Remove that — `useFastUpload` does it all. The submit path becomes: confirm a file is staged, then setSubmitted with starter info. The actual upload + transcribe fires inside `SubmittingHandoff`.

- [ ] **Step 4: Widen `sessionSourceKind` to accept `'upload'` in the `createDesignerSession` call.**

In `SubmittingHandoff`, the existing block derives `sessionSourceKind` from `resolved.kind`:

```ts
const sessionSourceKind: 'stock' | 'job' = resolved.kind;
const sessionSourceId =
  resolved.kind === 'stock' ? resolved.clipId : resolved.jobId;
```

Replace with:

```ts
const sessionSourceKind: 'stock' | 'job' | 'upload' = resolved.kind;
const sessionSourceId =
  resolved.kind === 'stock'
    ? resolved.clipId
    : resolved.kind === 'upload'
      ? resolved.userVideoId
      : resolved.jobId;
```

Also update the `createDesignerSession` signature in `web/src/lib/api.ts` to type its `sourceKind` parameter as `'stock' | 'job' | 'upload'`. Find it:

```bash
grep -n "createDesignerSession" web/src/lib/api.ts
```

Update accordingly.

- [ ] **Step 5: Remove the now-unused `createJobFromUpload` import from this file (keep the function exported — other call sites may still use it).**

```bash
grep -n "createJobFromUpload" web/src/pages/start/StartPage.tsx
```

Expected: 0 hits after the edit (or hits only inside a `LegacyUploadHandoff` if you kept the legacy branch for the flag in Task 13).

- [ ] **Step 6: Typecheck + manual smoke test.**

```bash
cd web && npx tsc -b --noEmit
cd ..
```

Then in the browser (with API + sidecar both running and a logged-in user):

1. Drop a 5–10s test clip.
2. Click Generate.
3. Expect: extracting → transcribing → designer mounts within ~5–8s. No `/jobs` POST in the network panel; just `/uploads/init`, `/transcribe`, S3 PUT, `/uploads/:id/finalize`.

- [ ] **Step 7: Commit.**

```bash
git add web/src/pages/start/StartPage.tsx web/src/lib/api.ts
git commit -m "StartPage: swap upload-starter Generate to fast-path (no job until Export)"
```

---

## Task 12: Sidecar process supervision in `start.sh`

**Files:**
- Modify: `scripts/start.sh`

- [ ] **Step 1: Launch the sidecar before the worker.**

Edit `scripts/start.sh`:

```sh
#!/bin/sh
# Railway / Docker entrypoint.
#
# Order: sidecar → worker → API. The sidecar must be reachable before
# the API begins accepting /transcribe traffic, but we don't block on it
# because model load is 5–10s — instead the /transcribe handler will
# 503 cleanly until the sidecar is up, and the browser retries.

log() { echo "[start.sh] $*"; }

log "launching whisper sidecar"
/opt/venv/bin/python transcribe-py/server.py &

log "launching jobs worker"
node --import tsx/esm src/worker/index.ts &

log "launching API (foreground) — PORT=${PORT:-3000}"
exec node --import tsx/esm src/api/server.ts
```

- [ ] **Step 2: Verify locally in container parity.**

If you have docker locally:

```bash
docker build -t test-captions . && docker run --rm -p 3000:3000 test-captions
```

Otherwise, just rerun start.sh:

```bash
sh scripts/start.sh
```

Expected logs (interleaved):
```
[start.sh] launching whisper sidecar
[start.sh] launching jobs worker
[start.sh] launching API (foreground) — PORT=3000
[sidecar] loading whisper large-v3 on cpu (int8)...
[sidecar] whisper loaded
[sidecar] listening on 127.0.0.1:8765
```

- [ ] **Step 3: Commit.**

```bash
git add scripts/start.sh
git commit -m "ops: launch whisper sidecar from start.sh"
```

---

## Task 13: Feature flag the fast path (one-release safety belt)

**Files:**
- Modify: `web/src/pages/start/StartPage.tsx`
- Modify: `.env.example` (or your existing env-doc file) to mention `VITE_UPLOAD_FAST_PATH`

- [ ] **Step 1: Add a build-time flag check.**

In `StartPage.tsx`, near the top:

```ts
const FAST_PATH_ENABLED = import.meta.env.VITE_UPLOAD_FAST_PATH === '1';
```

Then in the SubmittingHandoff effect that picks between paths:

```ts
if (FAST_PATH_ENABLED && starter.sourceKind === 'upload') {
  // new useFastUpload branch
} else if (starter.sourceKind === 'upload') {
  // existing createJobFromUpload branch (kept for one release)
}
```

The cleanest implementation: extract the legacy branch into a `LegacyUploadHandoff` component, and pick which to render based on the flag. This avoids tangling two `useEffect` flows in one component.

- [ ] **Step 2: Default the flag off in `.env.example`.**

Add:

```
# Set to 1 to enable the audio-first fast-path on the homepage Generate flow.
# When unset, the legacy createJobFromUpload pipeline is used. See
# docs/superpowers/specs/2026-05-22-fast-open-editor-design.md.
VITE_UPLOAD_FAST_PATH=
```

(If `.env.example` doesn't exist, document this in the closest README instead.)

- [ ] **Step 3: Smoke test both modes.**

In `web/.env.local`, set `VITE_UPLOAD_FAST_PATH=1`, restart `npm run dev:web`, run the homepage flow — fast path. Unset, restart, run again — legacy path. Both should land in the designer (fast path quickly, legacy via the worker if it's running, or stuck if not).

- [ ] **Step 4: Commit.**

```bash
git add web/src/pages/start/StartPage.tsx .env.example
git commit -m "feature flag: VITE_UPLOAD_FAST_PATH gates the new homepage flow"
```

---

## Task 14: Final smoke + cleanup

- [ ] **Step 1: Run full test suite.**

```bash
npm test
```

Expected: all green, including the new specs from tasks 1, 2, 4, 5, 9.

- [ ] **Step 2: Run typecheck.**

```bash
npm run typecheck
cd web && npx tsc -b --noEmit && cd ..
```

Expected: no errors.

- [ ] **Step 3: End-to-end browser run with the flag on.**

In separate terminals:
```bash
npm run sidecar          # terminal 1, wait for "whisper loaded"
npm run api              # terminal 2
cd web && VITE_UPLOAD_FAST_PATH=1 npm run dev    # terminal 3
```

In the browser:
1. Log in as a real user (or use `test_agent_key` cookie).
2. On `/`, pick a 10–30s clip, type "test", click Generate.
3. Watch the network panel: expect `/uploads/init`, `/transcribe`, S3 PUT, `/uploads/:id/finalize`. No `/jobs` POST.
4. Designer should mount within ~5s for 10s clips, ~10–15s for 30s clips.
5. Refresh the page after the designer mounts: should rehydrate from `user_videos.transcript` instantly.

- [ ] **Step 4: Confirm no new queued jobs accumulated.**

```bash
sqlite3 storage/captions.db "SELECT COUNT(*) FROM jobs WHERE status='queued';"
```

Expected: `0`.

- [ ] **Step 5: Final commit (if any small touch-ups are needed).**

If the smoke surfaced anything minor, commit it as:
```bash
git commit -m "fast-path: post-smoke fixups"
```

Otherwise, nothing to commit.

- [ ] **Step 6: Update the spec to "shipped".**

In `docs/superpowers/specs/2026-05-22-fast-open-editor-design.md`, change the `**Status:**` line from `approved, awaiting implementation plan` to `shipped 2026-MM-DD`.

```bash
git add docs/superpowers/specs/2026-05-22-fast-open-editor-design.md
git commit -m "docs: mark fast-open-editor spec as shipped"
```

---

## Out of scope (deferred — see spec)

- Streaming partial transcript over SSE.
- Two-tier model (small.en fast, large-v3 on export).
- External ASR providers.
- Removing the legacy `createJobFromUpload` path. Defer to the release after this one, once the fast path proves out under real traffic.
