# Video Editing Backend

Short-form video captioning and production system built on **Node.js/TypeScript** with **Python sidecars** for ML, **Remotion** for composition, and **ffmpeg** for video manipulation.

---

## Architecture Overview

```
                         +-----------+
                         |  Fastify  |
                         |  REST API |
                         +-----+-----+
                               |
                 +-------------+-------------+
                 |                           |
          +------v------+           +-------v--------+
          | Single-Video|           |   Producer     |
          |  Pipeline   |           |   Pipeline     |
          +------+------+           +-------+--------+
                 |                          |
    +------------+------------+    +--------+---------+
    |      |      |      |    |    | analyze | detect |
    |extract|transcribe|faces|    | classify| mode   |
    |audio  |(whisper) |(mp) |    | orchestrate      |
    |      |      |      |    |    | cut | narrate   |
    +------+------+------+----+    +--------+---------+
                 |                          |
          +------v------+           +-------v--------+
          |   Remotion  |           |   Remotion     |
          |   Renderer  |           |   Renderer     |
          | (local/lambda)          | (local/lambda) |
          +-------------+           +----------------+
```

**Storage**: SQLite (WAL mode) for job state, local filesystem or S3 for video assets.

---

## Single-Video Pipeline

Six stages, defined in `src/worker/pipeline.ts`:

| Stage | File | What it does |
|---|---|---|
| **Extract Audio** | `src/stages/extractAudio.ts` | ffmpeg extracts mono 16kHz WAV |
| **Transcribe** | `src/stages/transcribe.ts` | faster-whisper ASR + WhisperX alignment for per-word timestamps. VAD retry if first pass returns 0 words |
| **Detect Faces** | `src/stages/detectFaces.ts` | MediaPipe samples at ~4fps, returns normalized bounding boxes. Non-fatal |
| **Enrich** | `src/stages/enrichTranscript.ts` | Claude Haiku groups words into 2-5 word chunks with emphasis marking. Falls back to fixed-N chunking |
| **Render** | `src/stages/render.ts` | Dispatches to local Chromium or AWS Lambda based on `RENDER_MODE` |
| **Cleanup** | pipeline.ts | Deletes work directory and input file |

Transcribe and face detection run in parallel (face detection hides behind the ~10s transcription).

---

## Producer Pipeline

Seven stages for multi-file productions, defined in `src/worker/producerPipeline.ts`:

| Stage | File | What it does |
|---|---|---|
| **Analyze Assets** | `src/stages/analyzeAsset.ts`, `classifyAsset.ts` | Per-file ffprobe + transcription + face detection + Claude multimodal classification |
| **Detect Mode** | `src/stages/detectMode.ts` | Decides `speaker_montage` or `narrated_story` based on diarization + transcripts |
| **Orchestrate** | `src/stages/produceTimeline.ts` | Claude Haiku plans timeline: which clips, in/out points, audio keep/mute, optional narration script |
| **Cut Segments** | `src/stages/cutSegments.ts` | ffmpeg trims each timeline entry (stream-copy when possible) |
| **Narrate** | `src/stages/narrate.ts` | ElevenLabs TTS with character-level alignment, ffmpeg concat, timestamp rebasing. Only for `narrated_story` mode |
| **Pick Hook** | `src/stages/pickHook.ts` | Selects engagement-hook clip (LRU rotation per user), prepends to output |
| **Render** | `src/stages/render.ts` | Remotion StoryComposition with per-clip captions and optional split-screen |

An optional async step, **Generate Style** (`src/stages/generateStyle.ts`), converts natural-language style descriptions into a `StyleSpec` via Claude.

---

## Remotion Templates

All compositions live in `remotion/src/templates/` and are registered in `remotion/src/Root.tsx`.

### PopWords
Classic TikTok multi-word captions. Configurable max words per line, alignment, and optional background boxes. Uses `CaptionLayer` for rendering.

### SingleWord
MrBeast-style one huge word at a time. Dynamic size clamping based on word length to fit frame width.

### ThreeEffects
WebGL particle burst via react-three-fiber. Deterministic particle generation (seeded PRNG), gravity physics, orbit rotation on pop.

### KineticBurst
Premium WebGL with parametric bezier curve swoops, motion-blur ghost trails, spring overshoot, glowing emphasis halos, and orbital particle rings.

### StoryComposition
Multi-clip producer template. Sequences video/image clips with per-clip captions or title cards, a single global narration track, and optional split-screen (speaker top / brain-rot bottom).

---

## Caption Rendering

### CaptionLayer (`remotion/src/lib/CaptionLayer.tsx`)
Shared layer that renders per-chunk captions over video. Handles word grouping, emphasis styling, and fallback chunking.

### HopecoreCaptionLayer (`remotion/src/lib/HopecoreCaptionLayer.tsx`)
Editorial serif variant with dramatic per-word size variance: emphasis words render large uppercase, filler words shrink to small italic, with subtle per-chunk rotation.

### Animation Presets (`remotion/src/lib/animationPresets.ts`)

| Preset | Effect |
|---|---|
| **pop** | Spring scale-in (0.6 -> 1.0), emphasis boost, active-word boost |
| **fade** | Whole-chunk cross-fade |
| **karaoke** | Words visible from chunk start, color transition as timestamp is reached |
| **typewriter** | Words appear one-at-a-time with quick fade-in |
| **slide** | Words translate up 20px with fade and spring physics |

### Face-Aware Positioning (`remotion/src/lib/positioning.ts`)
Samples face bounding boxes at the current timestamp. If the largest face is in the bottom 40% of frame, captions move to the top (and vice versa).

---

## StyleSpec

Defined in `src/shared/styleSpec.ts` (Zod schema). All fields optional with sensible defaults.

```
font:      family, weight, size, letterSpacing, textTransform, variableAxes
color:     fill, stroke, strokeWidth, emphasisFill (single or palette),
           background, shadow, fillGradient
layout:    mode (classic/editorial), position, safeMargin, maxWordsPerLine,
           align, padding, borderRadius, gapRatio, singleWord config
animation: preset, durationMs, emphasisScale, scaleFrom, activeBoost,
           tailMs, spring (damping/stiffness/mass)
splitScreen: brainRot (boolean)
chunkOverrides: per-range style overrides
```

### Built-in Presets (`src/shared/presets.ts`)

**Single-video**: classic, tiktok-pop, minimal, big-word, big-word-pink, three-burst, kinetic-showcase, neon

**Producer**: story-rainbow, story-sunset, story-cyberpunk, story-editorial

Custom presets can be saved via `POST /presets`.

---

## Speech & Audio Processing

### Transcription (`transcribe-py/transcribe.py`)
- **faster-whisper** (large-v3 default) with Silero VAD
- **WhisperX** force-alignment for per-word timestamps
- Auto-detects language
- VAD retry: if pass 1 returns 0 words, retries with `--no-vad`

### Diarization (`transcribe-py/diarize.py`)
- **pyannote** speaker-diarization-3.1 via HuggingFace
- Per-segment speaker labels (SPEAKER_00, SPEAKER_01, ...)
- Soft-fails if `HUGGINGFACE_TOKEN` is missing

### TTS Narration (`src/stages/narrate.ts`)
- **ElevenLabs** `/with-timestamps` endpoint
- Per-beat audio generation with character-level alignment
- Content-addressable cache (default 500 MB cap)
- ffmpeg concat into single narration track
- Timestamps rebased to global timeline

---

## Rendering

### Local Mode (`src/stages/renderLocal.ts`)
Remotion bundle is cached at worker startup. Input video is staged into the bundle's `public/` directory. Renders via `@remotion/renderer` with H.264, 30fps, ANGLE GL (required for WebGL templates). Progress streamed to DB at 400ms intervals.

### Lambda Mode (`src/stages/renderLambda.ts`)
Input video uploaded to S3, then `renderMediaOnLambda()` splits into parallel chunks (default 50 frames each). Lambda state auto-deployed on first use and cached in `/storage/lambda-state.json`. Output written directly to S3 with presigned URLs returned via API.

### Output Format
- **Codec**: H.264, 30fps, MP4 container
- **Dimensions**: matches original input
- **Audio**: original pass-through (single-video) or ElevenLabs narration (producer narrated_story)

---

## LLM Integration

All Claude calls use **Haiku 4.5** via `@anthropic-ai/sdk` with prompt caching. Every call is **non-fatal** -- the system falls back to deterministic logic if the API is unavailable.

| Use | What it does |
|---|---|
| Enrich transcript | Semantic chunking + emphasis marking |
| Classify asset | Multimodal content classification (subject, tone, b-roll suitability) |
| Orchestrate | Multi-asset timeline planning with in/out points |
| Generate style | Natural-language description to StyleSpec conversion |

---

## Brain-Rot Pool (`src/shared/brainRotPool.ts`)

Engagement B-roll clips for split-screen backgrounds. Sources (in order): local `/storage/brain-rot/*.mp4`, then S3 `brain-rot/` prefix. Selection is deterministic via djb2 hash seeded on production ID, with LRU rotation per user for variety. Upload via `scripts/uploadBrainRot.ts`.

---

## Key Data Structures

**Transcript**: `{ language, duration, words: [{ word, start, end, confidence }] }`

**CaptionPlan**: `{ chunks: [{ words: Word[], emphasis: boolean[] }] }`

**FaceData**: `{ videoWidth, videoHeight, samples: [{ time, faces: [{ x, y, width, height, score }] }] }` (coordinates normalized 0-1)

---

## Resilience

- All LLM calls non-fatal (deterministic fallbacks)
- Face detection non-fatal (falls back to user preference)
- Diarization non-fatal (heuristic fallback)
- VAD retry for quiet speakers
- Per-stage DB writes so partial progress survives crashes
- Retention cron sweeps straggler files
