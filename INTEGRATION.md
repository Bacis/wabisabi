# Integration Guide

How to render captioned videos by talking to this service from another API.

The HTTP layer is one endpoint family:

- **`/jobs`** — caption a single uploaded video. Submit → poll → fetch output.

There are no webhooks. The server has **no authentication** out of the box —
put it behind your own gateway/VPN if you expose it publicly.

---

## Base URL and transport

| | |
|---|---|
| Protocol | HTTP/1.1 (no TLS by default — terminate upstream) |
| Default port | `3000` (override with `PORT`) |
| Multipart limit | 2 GB per request |
| Content type for submissions | `multipart/form-data` |
| Content type for status/preset endpoints | `application/json` |

`GET /` serves the built web dashboard (`web/dist/index.html`) when present.
It uses the same JSON API documented below — it is not separate.

---

## Single-video flow (`/jobs`)

### 1. Submit — `POST /jobs`

Multipart body. Upload a video file.

| Field | Type | Required | Notes |
|---|---|---|---|
| `video` | file | yes | The clip to caption. ≤ 2 GB. |
| `templateId` | string | no | Default `pop-words`. One of: `pop-words`, `reel-clone`. |
| `preset` | string | no | A preset id (built-in or custom). Loads its `templateId` and `styleSpec`; user `templateId`/`styleSpec` fields override per-key. |
| `styleSpec` | JSON string | no | Partial `StyleSpec` (see *Style*). Merged on top of the preset. |
| `keepInputMinutes` | int 1–1440 | no | Editor opt-in: keep the uploaded input on disk for N minutes after render so a follow-up render can reuse it. Without this the input is deleted right after a successful render. |
| `hidden` | `0`/`1`/`true` | no | Editor export-render flag. Hidden jobs run the same pipeline but don't appear in `GET /jobs`. |

**Response** `200 OK`:

```json
{ "id": "8b7…-uuid", "status": "queued", "createdAt": "2026-05-08 12:34:56" }
```

**Errors**: `400` (no video, or invalid styleSpec/templateId/preset).

#### curl

```bash
curl -X POST http://localhost:3000/jobs \
  -F "video=@clip.mp4" \
  -F "preset=classic"
```

#### Node 20+ (built-in `fetch`/`FormData`/`Blob`)

```ts
import { readFile } from 'node:fs/promises';

const form = new FormData();
form.set('video', new Blob([await readFile('clip.mp4')]), 'clip.mp4');
form.set('preset', 'classic');
form.set('styleSpec', JSON.stringify({ color: { fill: '#ff3366' } }));

const res = await fetch('http://localhost:3000/jobs', { method: 'POST', body: form });
const { id } = await res.json();
```

### 2. Poll — `GET /jobs/:id`

Returns the full row with JSON columns hydrated. Statuses progress
`queued → running → done | failed`.

```json
{
  "id": "…",
  "status": "running",
  "stage": "render",
  "templateId": "pop-words",
  "styleSpec": { "...": "..." },
  "transcript": null,
  "captionPlan": null,
  "faces": null,
  "progress": null,
  "error": null,
  "createdAt": "...", "startedAt": "...", "finishedAt": null,
  "inputPath": "/abs/storage/inputs/…",
  "outputPath": null,
  "inputAvailable": true
}
```

**`status`**: `queued | running | done | failed`
**`stage`** (only set while `running`): `extract_audio → analyze → enrich → render`

Recommended polling: every **2 seconds** is plenty; rendering is the long
stage and runs tens of seconds to a few minutes depending on clip length and
render mode (local Chromium vs. Lambda).

### 3. Download — `GET /jobs/:id/output`

| Status | Meaning |
|---|---|
| `200` | MP4 streaming — `Content-Type: video/mp4`, `Content-Length` set. |
| `302` | Lambda renders only — redirect to a presigned S3 URL. Follow it. |
| `404` | Unknown id. |
| `409` | Not ready yet — body is `{"error":"not ready","status":"<current>"}`. |
| `410` | Output file vanished (retention sweep). |
| `502` | S3 presign failed. |

Most HTTP clients follow `302` automatically — call this endpoint the same
way regardless of render mode.

#### Full TS example

```ts
async function captionVideo(serverUrl: string, file: Blob, presetId: string) {
  const form = new FormData();
  form.set('video', file, 'input.mp4');
  form.set('preset', presetId);

  const submit = await fetch(`${serverUrl}/jobs`, { method: 'POST', body: form });
  if (!submit.ok) throw new Error(`submit failed: ${submit.status}`);
  const { id } = (await submit.json()) as { id: string };

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const job = await (await fetch(`${serverUrl}/jobs/${id}`)).json();
    if (job.status === 'failed') throw new Error(job.error || 'render failed');
    if (job.status === 'done') break;
  }

  const out = await fetch(`${serverUrl}/jobs/${id}/output`); // follows 302 transparently
  if (!out.ok) throw new Error(`download failed: ${out.status}`);
  return await out.arrayBuffer();
}
```

---

## Style configuration

Three layers, applied in order: **preset defaults → user `styleSpec` →
`chunkOverrides`** (per-chunk patches inside the spec).

### Built-in presets

Listed via `GET /presets`. Source of truth is `src/shared/presets.ts` —
two built-ins ship today:

```
classic               reel-clone-default
```

Each entry exposes `{ id, name, description, templateId, styleSpec, source }`
where `source` is `"builtin"` or `"custom"`.

### Custom presets

| Endpoint | Purpose |
|---|---|
| `POST /presets` | Save `{id, name, description?, templateId, styleSpec}`. 409 if `id` collides with a built-in or existing custom id. |
| `DELETE /presets/:id` | Custom only; built-ins return 403. |

### `styleSpec` quick reference

The full Zod schema is in `src/shared/styleSpec.ts`. All fields are optional —
defaults match the original TikTok-style look. Top-level keys:

- `font`: `family`, `weight` (100–900), `size`, `letterSpacing`,
  `textTransform` (`none|uppercase|lowercase`), `variableAxes`
- `color`: `fill`, `stroke`, `strokeWidth`, `emphasisFill` (single color or
  array — palette cycles per chunk), `background`, `shadow`
  (`{color, blurPx, offsetX, offsetY}`), `fillGradient`
  (`{type:'linear', angle, stops:[{pos,color}]}`)
- `layout`: `mode` (`classic|editorial`), `position` (`top|middle|bottom`),
  `safeMargin` (0–0.5), `maxWordsPerLine`, `align`, `padding {x,y}`,
  `borderRadius`, `gapRatio`, `singleWord {sizeMultiplier, fitMargin, charAdvanceEst}`
- `animation`: `preset` (`pop|fade|karaoke|typewriter|slide`), `durationMs`,
  `emphasisScale`, `scaleFrom`, `activeBoost`, `tailMs`,
  `spring {damping, stiffness, mass}`
- `chunkOverrides`: `[{range:[startIdx, endIdx], overrides:{...}}]` —
  partial spec merged onto specific chunk indices.
- `charAdvance`: empirically measured glyph-width ratio (mainly used by
  `reel-clone`).
- `reel`: free-form bag for template-specific extension fields.

Colors must match `#rgb` / `#rrggbb` / `#rrggbbaa`.

### Live preview — `POST /jobs/:id/preview`

Renders one PNG frame for an existing job, useful for editor UIs:

```json
{ "styleSpec": { "color": { "fill": "#ff00ff" } }, "templateId": "pop-words", "frameSec": 1.5 }
```

Returns `image/png`. Requires the job to have completed transcription (will
400 with "missing transcript" if you call it on a brand-new job). Typical
latency 1–2 s; debounce ~500 ms.

### LLM-driven style — `POST /style/generate`

Natural-language → `StyleSpec` via Claude Haiku. Body:

```json
{ "query": "make it neon with pink emphasis #ff3366", "currentSpec": {…}, "templateId": "pop-words" }
```

Returns the merged spec.

---

## Operational notes

- **Polling, not webhooks.** If you need push, the cleanest extension is a
  `callbackUrl` field on `POST /jobs`. Worth deciding before rolling out
  integrations.
- **Input retention.** Uploaded inputs are deleted right after a successful
  render unless `keepInputMinutes` was set on submit. The retention sweeper
  reaps stragglers from crashed jobs after 1 hour.
- **Output retention.** Local outputs are reaped after 24 hours; the API
  returns `410 Gone` rather than `5xx` so callers can show an "expired"
  state. Lambda outputs live in S3 with the bucket's own 1-day lifecycle.
- **Render modes.** Driven by the server's `RENDER_MODE` env var (`local`
  or `lambda`). Callers don't see the difference — `/output` either streams
  the file or 302s.
- **Failure semantics.** Failed jobs end with `status: "failed"` and a
  populated `error` field; they are not retried automatically.
- **Concurrency.** SQLite WAL with a 5 s busy timeout. The worker leases
  jobs row-by-row, so submissions during a render simply queue.
- **No auth.** If the API will be reachable from anything other than your
  trusted backend, terminate auth at a gateway (mTLS, signed JWT, IP
  allowlist — anything you already use). Do not expose this directly to
  the public internet.

---

## Endpoint index

| Method | Path | |
|---|---|---|
| GET | `/health` | `{ ok: true }` liveness probe. |
| GET | `/` | Web dashboard (built `web/dist`, when present). |
| POST | `/jobs` | Submit single-video job. |
| GET | `/jobs` | List 50 most recent jobs (excludes hidden + expired). |
| GET | `/jobs/:id` | Job row, JSON columns hydrated. |
| GET | `/jobs/:id/input` | Stream original upload (or 302 to S3). |
| GET | `/jobs/:id/output` | MP4 stream or 302 to S3. |
| POST | `/jobs/:id/preview` | Single-frame PNG preview. |
| GET | `/presets` | Union of built-in + custom presets. |
| POST | `/presets` | Save custom preset. |
| DELETE | `/presets/:id` | Delete custom preset. |
| POST | `/style/generate` | NL → StyleSpec via Claude Haiku. |

For deeper architecture (rendering modes, template internals, schema
details) see `RENDERING.md` and `BACKEND.md`.
