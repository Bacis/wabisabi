# Fast open-editor for uploads — design

**Date:** 2026-05-22
**Author:** Andrius (via brainstorm)
**Status:** approved, awaiting implementation plan

## Problem

When a user uploads a video on the homepage and clicks Generate, the designer
view takes 30–60s to open. The pause feels broken — users have screenshotted
the loading skeleton and reported the app as "stuck".

The latency sits entirely in the pre-designer pipeline:

1. POST `/jobs` queues a row.
2. The job worker (a separate process — and not always running) claims it.
3. The worker downloads the full video from S3 back to its disk
   (`pipeline.ts:91`).
4. `extractAudio` runs ffmpeg over the full video.
5. `transcribe` spawns Python and loads `large-v3` from cold every time
   (~5–10s of overhead per spawn).
6. Faces + enrichment run.
7. The UI, which has been polling `/jobs/:id`, finally sees `transcript` and
   mounts `AgentDesigner`.

The Lambda render is **not** in this critical path — it only fires when the
user clicks Export. Lambda speed is a separate concern.

Stock clips already short-circuit all of this (transcripts pre-computed), and
their editor opens in ~10ms. The goal is to bring uploads close to that.

## Goal

Editor opens with a real transcript and the agent's first turn fired against
it within ~5s for typical clips (<30s of audio), degrading gracefully to
~10–30s for longer clips. No worker dependency on the editor-open path.

## Non-goals

- Speeding up Lambda render (separate problem).
- Removing the job worker (still owns Export-time face-detect, enrichment,
  and render dispatch).
- Streaming a partial transcript into the editor (deferred to Phase 2).
- Smaller / faster fast-path model (deferred to Phase 2; warm `large-v3` is
  the foundation either way).

## Approach

Move audio extraction into the browser, transcribe against a warm Python
sidecar, and decouple the editor-open path from the job lifecycle. Jobs are
minted only at Export.

### User-perceived flow

1. User picks a video file. Browser lazy-loads `ffmpeg.wasm` (25MB,
   one-time, cached by the SW after first use) and starts decoding the audio
   silently in the background while the user composes their prompt.
2. User clicks Generate. The browser fires three calls; the first is a
   tiny round-trip, the other two run in parallel after it:
   - First: `POST /uploads/init` (existing) → returns `userVideoId` + a
     presigned S3 PUT URL. ~50ms.
   - Parallel **audio fast lane** → `POST /transcribe` (multipart
     audio.wav, 1–2 MB) carrying `userVideoId` in a form field. API hands
     the file to a long-running Python sidecar that holds the `large-v3`
     model warm, returns the `Transcript` JSON, PATCHes
     `user_videos.transcript` so the result is durable across refresh.
   - Parallel **video slow lane** → browser PUTs the video bytes straight
     to the presigned S3 URL. When the PUT lands, browser fires
     `POST /uploads/:id/finalize` to flip `user_videos.status` to `ready`.
3. Designer mounts as soon as the transcript arrives. `userVideoId` is
   already known from step 1, so there's no waiting on the S3 PUT. Preview
   uses the local blob URL (`URL.createObjectURL(file)`).
4. `AgentChatPane` fires its first turn against the inline transcript,
   identical to the stock-clip path today.
5. S3 video upload finishes silently in the background. A small "syncing N%"
   pip in the editor chrome shows progress.
6. Export: `POST /jobs` with `userVideoId`, the designer's transcript, and
   styleSpec. Worker hits the existing `skipAnalysis` branch
   (`src/worker/pipeline.ts:97`), skips extract-audio/transcribe/enrich, runs
   face-detect + Lambda render.

### Components

| Piece | Where | Responsibility |
|---|---|---|
| `extractAudio` (browser) | `web/src/lib/fastUpload/extractAudio.ts` | Lazy-import `ffmpeg.wasm`; transcode to 16kHz mono WAV. Returns `Blob`. |
| `useFastUpload()` | `web/src/lib/useFastUpload.ts` | Orchestrate: extract audio → `/uploads/init` → parallel (`/transcribe` + S3 PUT + `/uploads/:id/finalize`) → expose `{ userVideoId, transcript, videoBlobUrl, uploadProgress$ }`. Replaces `useUploadVideo` for the homepage Generate flow. |
| `POST /transcribe` | `src/api/server.ts` | Multipart `audio` (required) + `userVideoId` (optional). Writes to `/tmp/transcribe-<uuid>.wav`, calls sidecar via localhost HTTP, PATCHes `user_videos.transcript` if `userVideoId` is given, returns `Transcript`. |
| `POST /transcribe-from-upload` | `src/api/server.ts` | Fallback for codec/size issues. Takes `userVideoId` only; sidecar fetches the audio range from S3 with `ffmpeg -i <presigned-url> -vn …`. Same response shape. |
| Whisper sidecar | `transcribe-py/server.py` (new) | FastAPI server on `127.0.0.1:$WHISPER_PORT`. Loads `large-v3` once at boot. Endpoint `POST /transcribe {path}` → `Transcript`. Same VAD-retry semantics as today's `transcribe.py`. |
| `useEditableSource` extension | `web/src/lib/useEditableSource.ts` | New branch `kind: 'upload'`. GETs `/uploads/:id` (which now returns `transcript` inline) and resolves immediately when present; falls back to short-polling if transcript is still pending. |

### Schema

- `user_videos`: add `transcript TEXT` (nullable JSON, same shape as today's
  `jobs.transcript`). Idempotent ALTER in `src/db.ts` via the existing
  `ensureColumn` pattern.
- `designer_sessions.sourceKind`: extend allowed values to include
  `'upload'`. No backfill; existing `'job'`-kind sessions keep working
  through the legacy `useEditableSource` job-polling branch.

### API contract additions

```ts
// POST /transcribe — multipart
//   field "audio": required, 16kHz mono WAV (other formats accepted, sidecar
//                  will re-encode if needed)
//   field "userVideoId": optional; if present, server PATCHes
//                        user_videos.transcript on success
// Response 200: Transcript (same shape as today's Transcript type)
// Response 503: sidecar unavailable

// POST /transcribe-from-upload — JSON
//   { userVideoId: string }
// Response 200: Transcript, also PATCHes user_videos.transcript
```

### Fallback paths

- **ffmpeg.wasm load failure or codec rejection:** UI swaps to "uploading,
  transcribing on server" copy. Flow becomes: video → S3 → POST
  `/transcribe-from-upload`. Slower than the fast path but still strictly
  faster than today (no worker, no queue, sidecar is warm).
- **File too large for browser decode (>500MB heuristic):** same as above.
- **Sidecar down:** endpoint 503s; UI shows a clear error toast. Strictly
  better signal than today's silent-stuck-in-queue.
- **Page refresh mid-flow:** designer mounts from `user_videos.transcript`
  if present; preview falls back to the S3 URL (may 404 briefly while video
  upload finishes). UI shows "video still syncing" until the S3 PUT lands.

### Process supervision

Adds one long-running process: the Python sidecar. Crash + restart is fine;
model reload takes 5–10s on warm disk cache. Memory cost: `large-v3` in
int8 ≈ ~3GB resident. Railway plan needs to allow this; verify before
shipping.

The sidecar is started alongside the API. Two options for orchestration,
to be locked at implementation time:
- Single Railway service with a `Procfile` running API + sidecar (simpler).
- Two Railway services with the sidecar bound to a private network (cleaner
  isolation; sidecar can scale independently if needed).

### Realistic latency math

`large-v3` int8 on CPU runs at roughly 0.3× realtime:

| Clip length | Inference (warm) | Audio extract (ffmpeg.wasm) | Multipart upload | **Total fast-path** |
|---|---|---|---|---|
| 10s | ~3s | ~0.5s | <0.5s | **~4s** |
| 30s | ~10s | ~1s | <0.5s | **~12s** |
| 60s | ~20s | ~1.5s | ~1s | **~23s** |
| 90s | ~30s | ~2s | ~1s | **~33s** |

The ≤5s target is honest for clips ≤30s. Past that, inference dominates and
the Phase-2 levers below become necessary if perceived speed still isn't
good enough.

## Phase 2 (deferred — not in this spec)

- **Streaming partial transcript** over SSE so the editor shows words as
  they're recognized. The agent's first turn could fire against the partial.
- **Two-tier model:** `small.en` or `base.en` for the fast path (~5× faster
  inference, slight accuracy hit), `large-v3` re-run as part of the Export
  job to get the high-quality transcript for the final render. Requires a
  decision on whether to keep both models loaded simultaneously (~4GB) or
  swap.
- **External ASR** (Deepgram / AssemblyAI / OpenAI). Real cost (~$0.01/min).
  Last resort if self-hosted ASR can't hit the target on Railway's CPU tier.

## Testing strategy

- Unit: `extractAudio` against representative codecs (h264/aac, h265/aac,
  vp9/opus, mov containers). ffmpeg.wasm has its own test surface; we test
  our wrapper.
- Unit: sidecar `/transcribe` against fixture WAVs, asserting the same
  Transcript shape today's pipeline emits (so the rest of the editor doesn't
  notice).
- Integration: full homepage flow with a fixture upload. Asserts: designer
  mounts within N seconds (parameterized), transcript present, no `jobs` row
  created.
- Manual: drag-and-drop a 30s and a 60s clip on the live Railway env,
  measure end-to-end with browser perf timeline. Bake into a periodic
  smoke-test.

## Migration / rollout

- Schema change is additive (one nullable column) — deploy server first.
- New endpoints can ship behind a feature flag (`UPLOAD_FAST_PATH=1`) for
  one release while we verify the sidecar holds up under real traffic.
- Legacy `createJobFromUpload` path stays wired (still used by any flow
  that doesn't go through the homepage) until we're confident the fast path
  is solid.

## Open questions

- Sidecar deployment shape on Railway (single service vs. side-car
  service) — defer to implementation when we know the memory ceiling.
- Whether to keep `ffmpeg.wasm` SW-cached or rely on browser HTTP cache —
  defer to web-platform-tests at implementation.
