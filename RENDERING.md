# Video Rendering Architecture

Implementation reference for the Remotion-based video captioning system. Dual render modes (local Chromium / AWS Lambda), two primary composition templates (PopWords, SingleWord), and a shared CaptionLayer.

---

## Table of Contents

1. [Render Dispatcher](#1-render-dispatcher)
2. [Local Rendering](#2-local-rendering)
3. [Lambda Rendering](#3-lambda-rendering)
4. [Remotion Bundle Cache](#4-remotion-bundle-cache)
5. [Lambda State Management](#5-lambda-state-management)
6. [S3 Output Management](#6-s3-output-management)
7. [Remotion Config](#7-remotion-config)
8. [Composition Registry](#8-composition-registry)
9. [Templates](#9-templates)
10. [CaptionLayer](#10-captionlayer)
11. [Animation Presets](#11-animation-presets)
12. [Style Merge & Chunk Overrides](#12-style-merge--chunk-overrides)
13. [StyleSpec Schema](#13-stylespec-schema)
14. [Environment Variables](#14-environment-variables)

---

## 1. Render Dispatcher

Single entry point. Reads `RENDER_MODE` env var, dynamically imports the matching implementation so local workers never bundle `@remotion/lambda` and Lambda workers skip Chromium.

```typescript
export type RenderArgs = {
  inputVideo: string;               // local file path
  transcript: Transcript;           // per-word timestamps from Whisper
  captionPlan: CaptionPlan | null;  // LLM-enriched chunks + emphasis
  faces: FaceData | null;           // face bounding boxes
  styleSpec: StyleSpec;             // fonts, colors, animation
  templateId: string;               // "pop-words", "single-word", etc.
  outputPath: string;               // hint; Lambda uses basename() only
  onProgress?: (progress: RenderProgress) => void;
};

export type RenderResult = {
  outputPath: string;  // local path or s3:// URI
};

const MODE = (process.env.RENDER_MODE ?? 'local').toLowerCase();

export async function renderCaptions(args: RenderArgs): Promise<RenderResult> {
  if (MODE === 'lambda') {
    const { renderCaptionsLambda } = await import('./renderLambda.js');
    return renderCaptionsLambda(args);
  }
  const { renderCaptionsLocal } = await import('./renderLocal.js');
  return renderCaptionsLocal(args);
}
```

---

## 2. Local Rendering

Uses `@remotion/renderer` with a cached webpack bundle. Input video is copied into the bundle's `public/` directory so Remotion's static handler can serve it.

```typescript
import { renderMedia, selectComposition } from '@remotion/renderer';
import { getRemotionBundle } from '../worker/remotionBundle.js';

const FPS = 30;
const GL = (process.env.REMOTION_GL ?? 'angle') as 'angle' | 'egl' | 'swangle' | 'swiftshader';

export async function renderCaptionsLocal(args: RenderArgs): Promise<RenderResult> {
  // 1. Probe input video
  const meta = await ffprobe(args.inputVideo);  // -> { width, height, duration }
  const { serveUrl, publicDir } = await getRemotionBundle();

  // 2. Stage input into bundle's public/ dir with random UUID name
  const stagedName = `${randomUUID()}${ext}`;
  await copyFile(args.inputVideo, join(publicDir, stagedName));
  const totalFrames = Math.max(1, Math.ceil(meta.duration * FPS));

  // 3. Build props — videoFile is a basename, not a full path
  const props = {
    videoFile: stagedName,
    videoMeta: { width: meta.width, height: meta.height, durationInFrames: totalFrames, fps: FPS },
    transcript: args.transcript,
    captionPlan: args.captionPlan,
    faces: args.faces,
    styleSpec: args.styleSpec,
  };

  // 4. Select composition and render
  const composition = await selectComposition({ serveUrl, id: args.templateId, inputProps: props });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: args.outputPath,
    inputProps: props,
    chromiumOptions: { gl: GL },  // ANGLE required for WebGL templates
    onProgress: ({ renderedFrames, encodedFrames, progress }) => {
      // Throttled to 400ms intervals (PROGRESS_INTERVAL_MS)
      args.onProgress?.({ mode: 'local', percent: Math.round((progress ?? 0) * 100), ... });
    },
  });

  // 5. Cleanup staged file
  await rm(stagedPath, { force: true }).catch(() => undefined);
  return { outputPath: args.outputPath };
}
```

**Key constants**: `FPS = 30`, `PROGRESS_INTERVAL_MS = 400`, codec `h264`, GL `angle`.

---

## 3. Lambda Rendering

Uses `@remotion/lambda/client`. Uploads input to S3, kicks off parallel Lambda render, polls for progress.

```typescript
import { renderMediaOnLambda, getRenderProgress } from '@remotion/lambda/client';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getLambdaState } from '../worker/remotionLambda.js';

const FPS = 30;
const FRAMES_PER_LAMBDA = Number(process.env.LAMBDA_FRAMES ?? 50);

export async function renderCaptionsLambda(args: RenderArgs): Promise<RenderResult> {
  const state = await getLambdaState();  // -> { region, functionName, serveUrl, bucketName }
  const s3 = new S3Client({ region: state.region });

  const meta = await ffprobe(args.inputVideo);
  const totalFrames = Math.max(1, Math.ceil(meta.duration * FPS));
  const totalChunks = Math.max(1, Math.ceil(totalFrames / FRAMES_PER_LAMBDA));

  // 1. Upload input to S3
  const inputKey = `caption-inputs/${randomUUID()}${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: state.bucketName, Key: inputKey,
    Body: await readFile(args.inputVideo), ContentType: 'video/mp4',
  }));

  // 2. Presign GET URL for Lambda to fetch (1h expiry)
  const inputUrl = await getSignedUrl(s3,
    new GetObjectCommand({ Bucket: state.bucketName, Key: inputKey }),
    { expiresIn: 3600 },
  );

  // 3. Props — videoFile is a full HTTPS URL (not basename)
  const props = {
    videoFile: inputUrl,  // templates detect 'http' prefix
    videoMeta: { width: meta.width, height: meta.height, durationInFrames: totalFrames, fps: FPS },
    transcript: args.transcript,
    captionPlan: args.captionPlan,
    faces: args.faces,
    styleSpec: args.styleSpec,
  };

  // 4. Output key: jobs/{basename}
  const outputKey = `jobs/${basename(args.outputPath)}`;
  const outputS3Uri = `s3://${state.bucketName}/${outputKey}`;

  // 5. Kick off Lambda render
  const { renderId } = await renderMediaOnLambda({
    region: state.region,
    functionName: state.functionName,
    serveUrl: state.serveUrl,
    composition: args.templateId,
    inputProps: props,
    codec: 'h264',
    framesPerLambda: FRAMES_PER_LAMBDA,
    privacy: 'private',
    maxRetries: 1,
    imageFormat: 'jpeg',
    chromiumOptions: { gl: 'angle' },
    outName: { bucketName: state.bucketName, key: outputKey },  // write directly to durable key
  });

  // 6. Poll every 1.5s until done
  for (;;) {
    const progress = await getRenderProgress({
      renderId, bucketName: state.bucketName,
      functionName: state.functionName, region: state.region,
    });
    if (progress.fatalErrorEncountered) throw new Error(progress.errors?.[0]?.message);
    args.onProgress?.({
      mode: 'lambda', percent: Math.floor((progress.overallProgress ?? 0) * 100),
      framesRendered: progress.framesRendered ?? 0,
      framesEncoded: progress.encodingStatus?.framesEncoded ?? 0,
      totalFrames, lambdasInvoked: progress.lambdasInvoked ?? 0, totalChunks, ...
    });
    if (progress.done) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 7. Best-effort cleanup of staged input
  s3.send(new DeleteObjectCommand({ Bucket: state.bucketName, Key: inputKey })).catch(() => {});
  return { outputPath: outputS3Uri };  // output stays in S3, never downloaded
}
```

---

## 4. Remotion Bundle Cache

Webpack bundling takes ~20s. Cached as a singleton Promise across all renders in the worker process.

```typescript
import { bundle } from '@remotion/bundler';

const REMOTION_ROOT = resolve(process.env.REMOTION_PROJECT ?? './remotion');
const ENTRY = join(REMOTION_ROOT, 'src/index.ts');

export type RemotionBundle = {
  serveUrl: string;   // webpack output directory
  publicDir: string;  // serveUrl + '/public/' for staging input videos
};

let cached: Promise<RemotionBundle> | null = null;

export function getRemotionBundle(): Promise<RemotionBundle> {
  if (!cached) {
    cached = bundle({ entryPoint: ENTRY })
      .then(async (serveUrl) => {
        const publicDir = join(serveUrl, 'public');
        await mkdir(publicDir, { recursive: true });
        return { serveUrl, publicDir };
      })
      .catch((err) => { cached = null; throw err; });  // reset on failure for retry
  }
  return cached;
}
```

---

## 5. Lambda State Management

Manages Lambda function, S3 bucket, and Remotion site. Hashes the composition source tree to detect changes and auto-redeploy.

```typescript
import { deployFunction, deploySite, getFunctions, getOrCreateBucket } from '@remotion/lambda';

const REGION = (process.env.AWS_REGION ?? 'us-east-1') as AwsRegion;
const COMPOSITION_ROOT = join(REMOTION_PROJECT, 'src');
const STATE_FILE = join(STATE_DIR, 'lambda-state.json');
const SITE_NAME = 'captions-site';

export type LambdaState = {
  region: string;
  functionName: string;
  serveUrl: string;
  bucketName: string;
  compositionHash: string;  // first 16 hex chars of SHA256 of src/ tree
};

// Walks remotion/src/, hashes all .ts/.tsx/.css/.json files
async function hashCompositionTree(root: string): Promise<string> {
  const files: string[] = [];
  // recursive walk, sort, then:
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relativePath); hash.update('\0');
    hash.update(content);      hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

export async function getLambdaState(): Promise<LambdaState> {
  const currentHash = await hashCompositionTree(COMPOSITION_ROOT);
  if (cached && cached.hash === currentHash) return cached.state;
  if (inflight) return inflight;  // wait for in-progress redeploy
  inflight = ensureState(currentHash).then(state => { cached = { state, hash: currentHash }; return state; });
  return inflight;
}

async function ensureState(currentHash: string): Promise<LambdaState> {
  // 1. Try on-disk cache (storage/lambda-state.json)
  //    If hash matches -> return immediately

  // 2. Function: reuse cached name -> discover existing -> deploy fresh
  const result = await deployFunction({
    region: REGION,
    timeoutInSeconds: 240,   // 4 min
    memorySizeInMb: 2048,    // 2 GB RAM
    diskSizeInMb: 2048,      // 2 GB /tmp
    createCloudWatchLogGroup: true,
  });

  // 3. Bucket: reuse cached -> getOrCreateBucket()
  const bucket = await getOrCreateBucket({ region: REGION });

  // 4. Site: always (re)deploy when hash changes
  const site = await deploySite({
    entryPoint: join(REMOTION_PROJECT, 'src/index.ts'),
    bucketName, siteName: SITE_NAME, region: REGION,
  });

  // 5. Persist state to lambda-state.json
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}
```

**To force redeploy**: delete the cached `lambda-state.json` file.

---

## 6. S3 Output Management

Parses `s3://` URIs, generates presigned URLs, and installs lifecycle rules for automatic garbage collection.

```typescript
// Lifecycle rules — installed idempotently on the Remotion-managed bucket
const OWNED_RULES = [
  { id: 'captions-jobs-1d-expiry',       prefix: 'jobs/',               days: 1 },
  { id: 'captions-inputs-1d-expiry',     prefix: 'caption-inputs/',     days: 1 },
  { id: 'producer-clips-1d-expiry',      prefix: 'producer-clip-',      days: 1 },
  { id: 'producer-narration-1d-expiry',  prefix: 'producer-narration/', days: 1 },
  { id: 'producer-outputs-7d-expiry',    prefix: 'productions/',        days: 7 },
];

export function parseS3Uri(value: string): { bucket: string; key: string } | null {
  if (!value.startsWith('s3://')) return null;
  // parse bucket and key from s3://bucket/key
}

export async function presignOutputUrl(uri: string, expiresInSec = 3600): Promise<string> {
  const parsed = parseS3Uri(uri);
  return getSignedUrl(getClient(),
    new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
    { expiresIn: expiresInSec },
  );
}

export async function ensureOutputLifecycle(bucketName: string): Promise<void> {
  // Reads existing rules, checks if owned rules already match
  // If not: merges owned rules (preserving non-owned), PutBucketLifecycleConfiguration
  // Non-fatal on error
}
```

---

## 7. Remotion Config

```typescript
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');          // smaller intermediate frames
Config.setOverwriteOutput(true);
Config.setConcurrency(null);                 // all CPU cores
Config.setChromiumOpenGlRenderer('angle');   // hardware WebGL (required for three-effects)
```

Note: the Remotion config only applies to CLI renders. Programmatic `renderMedia()` calls need explicit `chromiumOptions: { gl: 'angle' }`.

---

## 8. Composition Registry

All compositions are registered in `Root.tsx`. Default dimensions: 1080x1920 @ 30fps. Actual dimensions come from `calculateMetadata` which reads `props.videoMeta`.

```typescript
// Zod schemas for prop validation
const wordSchema = z.object({ word: z.string(), start: z.number(), end: z.number(), confidence: z.number() });
const captionPlanSchema = z.object({ chunks: z.array(z.object({ words: z.array(wordSchema), emphasis: z.array(z.boolean()) })) }).nullable();
const facesSchema = z.object({ videoWidth: z.number(), videoHeight: z.number(), videoFps: z.number(), videoDuration: z.number(), samples: z.array(z.object({ time: z.number(), faces: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), score: z.number() })) })) }).nullable();

// Single-video props
const propsSchema = z.object({
  videoFile: z.string(),     // basename (local) or HTTPS URL (Lambda)
  videoMeta: z.object({ width: z.number(), height: z.number(), durationInFrames: z.number(), fps: z.number() }),
  transcript: z.object({ language: z.string(), duration: z.number(), words: z.array(wordSchema) }),
  captionPlan: captionPlanSchema,
  faces: facesSchema,
  styleSpec: z.any(),
});

// Dynamic metadata from props
const calculateMetadata = async ({ props }) => ({
  width: props.videoMeta.width,
  height: props.videoMeta.height,
  durationInFrames: props.videoMeta.durationInFrames,
  fps: props.videoMeta.fps,
});

// Compositions (primary templates)
<Composition id="pop-words"    component={PopWords}    schema={propsSchema} defaultProps={defaultProps} calculateMetadata={calculateMetadata} />
<Composition id="single-word"  component={SingleWord}  schema={propsSchema} defaultProps={defaultProps} calculateMetadata={calculateMetadata} />
```

**`videoFile` handling in templates**: All templates detect `videoFile.startsWith('http')` — if true, use the URL directly (Lambda mode); otherwise wrap with `staticFile(videoFile)` (local mode). This is the only difference between local and Lambda prop shapes.

---

## 9. Templates

### 9a. PopWords

Classic TikTok multi-word captions. Thin wrapper over `CaptionLayer`.

```typescript
export const PopWords: React.FC<Props> = ({ videoFile, transcript, captionPlan, faces, styleSpec }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoFile && (
        <OffthreadVideo src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)} />
      )}
      <CaptionLayer transcript={transcript} captionPlan={captionPlan} faces={faces} styleSpec={styleSpec} />
    </AbsoluteFill>
  );
};
```

### 9b. SingleWord

One large word at a time (MrBeast style). Manages its own rendering loop instead of using `CaptionLayer`.

**Key functions**:

- `buildWordInfo(plan)` — maps each word's `start` time to `{ isEmphasis, chunkIdx }` for O(1) lookup
- `findActiveWord(words, t, tailSec)` — finds the single word being spoken at time `t`
- `resolveStyle(spec)` — merges StyleSpec with SingleWord-specific defaults (weight 900, letterSpacing -2, position middle, tailMs 500)

```typescript
export const SingleWord: React.FC<Props> = ({ videoFile, transcript, captionPlan, faces, styleSpec }) => {
  const frame = useCurrentFrame();
  const { fps, width: frameWidth } = useVideoConfig();
  const t = frame / fps;

  const baseResolved = resolveStyle(styleSpec);

  // Karaoke makes no sense for single words — convert to pop
  const effectivePreset = baseResolved.anim.preset === 'karaoke' ? 'pop' : baseResolved.anim.preset;

  // Fit-clamp: measure longest word, cap font size so it fits in 85% of frame width
  const longestWordChars = Math.max(1, ...transcript.words.map((w) => w.word.length));
  const usableWidth = frameWidth * baseResolved.singleWord.fitMargin;       // 0.85
  const maxFitSize = usableWidth / (longestWordChars * baseResolved.singleWord.charAdvanceEst);  // 0.6

  const wordInfo = React.useMemo(() => buildWordInfo(captionPlan), [captionPlan]);
  const activeWord = findActiveWord(transcript.words, t, baseResolved.anim.tailMs / 1000);

  // Per-chunk style overrides
  const chunkSpec = resolveChunkStyle(chunkIdx, styleSpec, styleSpec.chunkOverrides);
  const r = resolveStyle(chunkSpec);
  const renderSize = Math.min(r.font.size * r.singleWord.sizeMultiplier, maxFitSize);  // 72 * 2.4 = 173px, clamped

  // Face-aware position
  const position = effectivePosition(faces, t, r.layout.position);

  // Animate word
  const anim = animateWord(effectivePreset, { t, frame, fps, word: activeWord, isEmphasis, ... });

  // Render single <span> with transform + opacity from anim
  return (
    <AbsoluteFill>
      <OffthreadVideo src={...} />
      {activeWord && anim && (
        <div style={{ position: 'absolute', ...positionStyle, display: 'flex', justifyContent: 'center' }}>
          <span style={{
            fontFamily: r.font.family, fontWeight: r.font.weight, fontSize: renderSize,
            WebkitTextStroke: `${r.color.strokeWidth}px ${r.color.stroke}`,
            paintOrder: 'stroke fill',
            transform: anim.transform, opacity: anim.opacity,
            color: anim.color,
          }}>
            {activeWord.word}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};
```

---

## 10. CaptionLayer

Flex-row caption overlay used by PopWords. One chunk visible at a time.

**Exported types**:
```typescript
export type Word = { word: string; start: number; end: number; confidence: number };
export type Transcript = { language: string; duration: number; words: Word[] };
export type CaptionChunk = { words: Word[]; emphasis: boolean[] };
export type CaptionPlan = { chunks: CaptionChunk[] };
```

**Key functions**:
- `fallbackChunks(words, maxPerLine)` — groups words into chunks of N with all emphasis=false
- `toPalette(emphasisFill, fallback)` — normalizes `string | string[]` to `string[]`
- `buildGradientImage(gradient)` — returns CSS `linear-gradient(...)` string
- `buildTextShadow(shadow)` — returns CSS `text-shadow` value
- `buildVariationSettings(axes)` — returns CSS `font-variation-settings` value
- `resolveStyle(spec)` — merges StyleSpec with defaults, returns resolved object

```typescript
export function resolveStyle(spec: StyleSpec) {
  const font = { family: 'Inter', weight: 800, size: 72, letterSpacing: 0, textTransform: 'uppercase', ...spec.font };
  const color = { fill: '#ffffff', stroke: '#000000', strokeWidth: 8, emphasisFill: '#ffe14b', ...spec.color };
  const layout = { position: 'bottom', safeMargin: 0.15, maxWordsPerLine: 4, align: 'center', borderRadius: 16, gapRatio: 0.25, ...spec.layout };
  const padding = { x: 24, y: 12, ...spec.layout?.padding };
  const anim = { preset: 'pop', durationMs: 120, emphasisScale: 1.15, scaleFrom: 0.6, activeBoost: 1.06, tailMs: 200, ...spec.animation };
  const springCfg = { damping: 12, stiffness: 200, mass: 0.6, ...spec.animation?.spring };
  return { font, color, layout, padding, anim, springCfg,
    emphasisPalette: toPalette(color.emphasisFill, '#ffe14b'),
    gradientImage: color.fillGradient ? buildGradientImage(color.fillGradient) : undefined,
    textShadow: buildTextShadow(color.shadow),
    variationSettings: buildVariationSettings(font.variableAxes),
  };
}
```

**Rendering flow** (inside `CaptionLayer` component):
```typescript
export const CaptionLayer: React.FC<Props> = ({ transcript, captionPlan, faces, styleSpec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const baseResolved = resolveStyle(styleSpec);

  // 1. Get chunks (LLM plan or fallback)
  const chunks = captionPlan ? captionPlan.chunks : fallbackChunks(transcript.words, baseResolved.layout.maxWordsPerLine);

  // 2. Find active chunk — first chunk where t is between first word start and last word end + tail
  const tailSec = baseResolved.anim.tailMs / 1000;
  const activeChunkIdx = chunks.findIndex(c =>
    c.words.length > 0 && t >= c.words[0].start && t <= c.words[c.words.length - 1].end + tailSec
  );
  if (activeChunkIdx < 0) return null;  // no caption on screen
  const activeChunk = chunks[activeChunkIdx];

  // 3. Apply per-chunk style overrides
  const chunkSpec = resolveChunkStyle(activeChunkIdx, styleSpec, styleSpec.chunkOverrides);
  const r = resolveStyle(chunkSpec);

  // 4. Emphasis color from palette (cycles by chunk index)
  const chunkEmphasisColor = r.emphasisPalette[activeChunkIdx % r.emphasisPalette.length];

  // 5. Face-aware position
  const position = effectivePosition(faces, t, r.layout.position);

  // 6. Render each word in the chunk
  return (
    <div style={{ position: 'absolute', ...positionStyle, display: 'flex', justifyContent: justify, padding: '0 5%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${r.font.size * r.layout.gapRatio}px`,
                    justifyContent: 'center', maxWidth: '90%',
                    backgroundColor: r.color.background ?? 'transparent',
                    padding: r.color.background ? `${r.padding.y}px ${r.padding.x}px` : 0,
                    borderRadius: r.layout.borderRadius }}>
        {activeChunk.words.map((w, i) => {
          const isEmphasis = activeChunk.emphasis[i] ?? false;

          // Reserve flex space for transform overshoot
          const peakScale = (isEmphasis ? r.anim.emphasisScale : 1) * r.anim.activeBoost;
          const estWordWidth = w.word.length * r.font.size * 0.55;
          const overshootMarginPx = Math.max(0, (peakScale - 1) * estWordWidth) / 2;

          // Animate this word
          const anim = animateWord(r.anim.preset, {
            t, frame, fps, word: w, isEmphasis,
            chunkStart: activeChunk.words[0].start,
            fillColor: r.color.fill, emphasisColor: chunkEmphasisColor,
            scaleFrom: r.anim.scaleFrom, emphasisScale: r.anim.emphasisScale,
            activeBoost: r.anim.activeBoost, durationMs: r.anim.durationMs,
            spring: r.springCfg,
          });

          // Gradient fill: only on non-emphasis words (emphasis uses solid emphasisColor)
          const useGradient = r.gradientImage && anim.color === r.color.fill;

          return (
            <span key={i} style={{
              fontFamily: r.font.family, fontWeight: r.font.weight, fontSize: r.font.size,
              letterSpacing: r.font.letterSpacing, textTransform: r.font.textTransform,
              color: useGradient ? 'transparent' : anim.color,
              backgroundImage: useGradient ? r.gradientImage : undefined,
              backgroundClip: useGradient ? 'text' : undefined,
              WebkitTextStroke: `${r.color.strokeWidth}px ${r.color.stroke}`,
              paintOrder: 'stroke fill',
              transform: anim.transform, opacity: anim.opacity,
              display: 'inline-block', lineHeight: 1,
              textShadow: r.textShadow,
              fontVariationSettings: r.variationSettings,
              transition: 'color 80ms linear',
              marginInline: overshootMarginPx,
            }}>
              {w.word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
```

---

## 11. Animation Presets

Five animation modes. Called per-word by CaptionLayer and SingleWord.

```typescript
export type WordCtx = {
  t: number; frame: number; fps: number;
  word: { start: number; end: number };
  isEmphasis: boolean;
  chunkStart: number;           // for fade preset (whole-chunk animation)
  fillColor: string; emphasisColor: string;
  scaleFrom: number; emphasisScale: number; activeBoost: number; durationMs: number;
  spring: { damping: number; stiffness: number; mass: number };
};

export type WordStyle = { color: string; opacity: number; transform: string };

// Spring progress from an absolute time
function springFrom(sec: number, ctx: WordCtx): number {
  const durFrames = Math.max(1, Math.round((ctx.durationMs / 1000) * ctx.fps));
  return spring({ frame: ctx.frame - Math.round(sec * ctx.fps), fps: ctx.fps,
    config: ctx.spring, durationInFrames: durFrames });
}

export function animateWord(preset: string, ctx: WordCtx): WordStyle {
  const isActive = ctx.t >= ctx.word.start && ctx.t <= ctx.word.end;

  switch (preset) {
    case 'fade': {
      // Whole chunk fades together from chunkStart
      const p = springFrom(ctx.chunkStart, ctx);
      return { color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
               opacity: interpolate(p, [0, 1], [0, 1]), transform: 'none' };
    }
    case 'karaoke': {
      // All words visible from chunk start. Color transitions at word.start
      const ramp = clamp((ctx.t - ctx.word.start) / Math.max(0.04, ctx.word.end - ctx.word.start));
      return { color: ramp > 0 ? ctx.emphasisColor : ctx.fillColor, opacity: 1, transform: 'none' };
    }
    case 'typewriter': {
      // Words appear one-at-a-time with fade
      const p = springFrom(ctx.word.start, ctx);
      return { color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
               opacity: interpolate(p, [0, 1], [0, 1]), transform: 'none' };
    }
    case 'slide': {
      // Slide up 20px with fade
      const p = springFrom(ctx.word.start, ctx);
      return { color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
               opacity: interpolate(p, [0, 1], [0, 1]),
               transform: `translateY(${interpolate(p, [0, 1], [20, 0])}px)` };
    }
    case 'pop': default: {
      // Spring scale with emphasis + active boost
      const p = springFrom(ctx.word.start, ctx);
      const baseScale = ctx.isEmphasis ? ctx.emphasisScale : 1;
      const target = baseScale * (isActive ? ctx.activeBoost : 1);
      const scale = interpolate(p, [0, 1], [ctx.scaleFrom, target]);
      return { color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
               opacity: interpolate(p, [0, 1], [0, 1]),
               transform: `scale(${scale})` };
    }
  }
}
```

---

## 12. Style Merge & Chunk Overrides

Two-level shallow merge for per-chunk style overrides.

```typescript
export type ChunkOverride = {
  range: [number, number];           // [startChunkIdx, endChunkIdx] inclusive
  overrides: Record<string, unknown>; // partial StyleSpec
};

// Two-level merge: objects get {...base, ...override}, arrays/primitives get replaced
export function mergeStyleSpec(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key], overrideVal = override[key];
    if (baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal) &&
        overrideVal && typeof overrideVal === 'object' && !Array.isArray(overrideVal)) {
      out[key] = { ...(baseVal as object), ...(overrideVal as object) };
    } else if (overrideVal !== undefined) {
      out[key] = overrideVal;
    }
  }
  return out;
}

// Walk overrides in order, merge matching ranges. Later entries win.
export function resolveChunkStyle(chunkIdx: number, baseSpec: Record<string, unknown>, overrides: ChunkOverride[] | undefined): Record<string, unknown> {
  if (!overrides || overrides.length === 0) return baseSpec;
  let result = baseSpec;
  for (const o of overrides) {
    if (chunkIdx >= o.range[0] && chunkIdx <= o.range[1]) {
      result = mergeStyleSpec(result, o.overrides);
    }
  }
  return result;
}
```

---

## 13. StyleSpec Schema

Zod schema. All fields optional, defaults produce classic TikTok style.

```typescript
const colorSchema = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
const gradientStopSchema = z.object({ pos: z.number().min(0).max(1), color: colorSchema });
const gradientSchema = z.object({ type: z.literal('linear').default('linear'), angle: z.number().default(90), stops: z.array(gradientStopSchema).min(2) });
const shadowSchema = z.object({ color: colorSchema.default('#000000cc'), blurPx: z.number().min(0).default(0), offsetX: z.number().default(0), offsetY: z.number().default(0) });

export const StyleSpecSchema = z.object({
  font: z.object({
    family: z.string().default('Inter'),
    weight: z.number().int().min(100).max(900).default(800),
    size: z.number().positive().default(72),
    letterSpacing: z.number().default(0),
    textTransform: z.enum(['none', 'uppercase', 'lowercase']).default('uppercase'),
    variableAxes: z.record(z.string(), z.number()).optional(),
  }).default({}),
  color: z.object({
    fill: colorSchema.default('#ffffff'),
    stroke: colorSchema.default('#000000'),
    strokeWidth: z.number().min(0).default(8),
    emphasisFill: z.union([colorSchema, z.array(colorSchema).min(1)]).default('#ffe14b'),
    background: colorSchema.optional(),
    shadow: shadowSchema.optional(),
    fillGradient: gradientSchema.optional(),
  }).default({}),
  layout: z.object({
    mode: z.enum(['classic', 'editorial']).default('classic'),
    position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
    safeMargin: z.number().min(0).max(0.5).default(0.15),
    maxWordsPerLine: z.number().int().positive().default(4),
    align: z.enum(['left', 'center', 'right']).default('center'),
    padding: z.object({ x: z.number().min(0).default(24), y: z.number().min(0).default(12) }).default({}),
    borderRadius: z.number().min(0).default(16),
    gapRatio: z.number().min(0).default(0.25),
    singleWord: z.object({
      sizeMultiplier: z.number().positive().default(2.4),
      fitMargin: z.number().min(0).max(1).default(0.85),
      charAdvanceEst: z.number().positive().default(0.6),
    }).default({}),
  }).default({}),
  chunkOverrides: z.array(z.object({
    range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    overrides: z.record(z.string(), z.any()),
  })).optional(),
  splitScreen: z.object({ brainRot: z.boolean().default(false) }).default({}),
  animation: z.object({
    preset: z.enum(['pop', 'fade', 'karaoke', 'typewriter', 'slide']).default('pop'),
    durationMs: z.number().positive().default(120),
    emphasisScale: z.number().min(1).max(3).default(1.15),
    scaleFrom: z.number().min(0).max(1).default(0.6),
    activeBoost: z.number().min(1).max(2).default(1.06),
    tailMs: z.number().min(0).default(200),
    spring: z.object({
      damping: z.number().positive().default(12),
      stiffness: z.number().positive().default(200),
      mass: z.number().positive().default(0.6),
    }).default({}),
  }).default({}),
}).default({});

export type StyleSpec = z.infer<typeof StyleSpecSchema>;
```

---

## 14. Environment Variables

| Variable | Default | Used by |
|----------|---------|---------|
| `RENDER_MODE` | `"local"` | `render.ts` — `"local"` or `"lambda"` |
| `REMOTION_GL` | `"angle"` | `renderLocal.ts` — GL driver for Chromium |
| `REMOTION_PROJECT` | `"./remotion"` | `remotionBundle.ts`, `remotionLambda.ts` — project root |
| `LAMBDA_FRAMES` | `50` | `renderLambda.ts` — frames per Lambda chunk |
| `AWS_REGION` | `"us-east-1"` | `remotionLambda.ts`, `s3Outputs.ts` |
| `AWS_ACCESS_KEY_ID` | — | AWS SDK |
| `AWS_SECRET_ACCESS_KEY` | — | AWS SDK |
| `STORAGE_DIR` | `"./storage"` | `remotionLambda.ts` — location of `lambda-state.json` |

