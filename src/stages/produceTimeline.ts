import {
  ProductionPlanSchema,
  type NarrationBeat,
  type ProductionAsset,
  type ProductionMode,
  type ProductionPlan,
  type TimelineEntry,
} from '../shared/productionTypes.js';

// The "producer agent" — given analyzed assets + target cap, return a
// timeline the cutter can execute. Tries Claude Haiku first; falls back to
// a deterministic greedy builder on any failure so the pipeline never
// hard-fails.

const SPEAKER_MONTAGE_SYSTEM = `You are a video editor building a short-form vertical video (TikTok/Reels/Shorts) from multiple talking-head clips.

Your job: pick the most compelling continuous segments from the MAIN SPEAKER (the person with the longest total speech time across the assets) and order them into a coherent short. Total duration must target the requested capSeconds.

Inputs you receive:
- USER BRIEF (optional): the uploader's creative direction. If present, prefer segments whose content aligns with the brief's subject, tone, and angle. Use the brief to guide ordering and emphasis, not to fabricate content that isn't in the transcripts.
- capSeconds: target duration
- assets: each with id, durationSec, transcript.words (with per-word times), diarization (if available), analysis (scene description)

HARD RULES:
- Output JSON only. No prose, no markdown fences.
- Pick continuous sentence-aligned segments. Use word timestamps to find sentence boundaries (pauses >0.5s, punctuation cues).
- Never split mid-sentence. A segment's inSec should start at a word's start; outSec at a word's end.
- All timeline entries MUST have role="speaker" and keepAudio=true.
- Every assetId in the timeline must exist in the asset list.
- Sum of (outSec - inSec) must be within ±15% of capSeconds.
- Omit filler, repetition, false starts. Prefer segments where the speaker's face is visible (has faces).

Output schema:
{
  "mode": "speaker_montage",
  "targetDurationSec": number,
  "timeline": [
    { "assetId": "...", "role": "speaker", "inSec": 0, "outSec": 0, "keepAudio": true }
  ],
  "notes": "one short sentence on the editorial angle"
}`;

const NARRATED_STORY_SYSTEM = `You are a short-form video producer building a narrated social clip from silent b-roll, still images, and optionally some low-speech video.

Your job: (1) write a tight narration script that tells a short, concrete story about the uploaded assets, and (2) assign each asset to a narration beat so the footage visually matches what's being said.

Inputs you receive:
- USER BRIEF (optional): the uploader's creative direction — the story they want told, subject matter, tone. When present, this IS the story. Write narration that delivers the brief's premise using the visuals as supporting evidence. Match the brief's tone (enthusiastic, documentary, playful, etc.). Do not invent facts not grounded in the brief or the asset analyses.
- capSeconds: target duration
- assets: each with id, kind ("video"|"image"), durationSec, analysis.{subject,sceneTags,caption,emotionalTone,bRollFriendly}

PACING PHILOSOPHY (very important — this is a modern short, not a slideshow):
- Fast cuts. Modern TikTok/Reels/Shorts feel energetic because no single shot lingers.
- Target 6–10 beats total. Each beat is 2.0–3.5 seconds. Avoid long single beats.
- Visual variety > asset variety. If you have fewer assets than beats, that's fine — but DON'T just repeat a whole clip. Use the SAME asset at TWO DIFFERENT inSec windows (e.g., asset X at [0–3] for one beat AND at [7–10] for a later beat) and place the two windows NON-ADJACENT in the timeline (at least 2 beats apart from each other).
- When an asset's durationSec supports it (>= 5s), prefer splitting it across two beats over reusing a single range.
- Images can appear more than once too; use different narrationIndex values for each appearance.
- The FIRST beat should land on a visually striking asset (isPersonOnCamera=true or a group shot). The LAST beat should land something conclusive.

HARD RULES:
- Output JSON only. No prose, no markdown fences.
- Narration pace: ~2.5 words/sec. Each beat's word count ≈ (endSec - startSec) * 2.5. Keep sentences short and punchy.
- Beat durations should sum to roughly capSeconds (within ±20%).
- For each timeline entry:
  - role = "image" if the asset is an image, else "broll"
  - keepAudio = false (narration replaces original audio)
  - inSec = 0 for images; for videos, pick a visually interesting moment INSIDE the asset's durationSec. For split assets, pick inSec values that are at least 2s apart.
  - outSec - inSec MUST match the assigned beat's duration (endSec - startSec)
  - narrationIndex = the beat index (0-based)
- Every timeline entry's outSec <= its asset's durationSec.

Output schema:
{
  "mode": "narrated_story",
  "targetDurationSec": number,
  "timeline": [
    {"assetId":"...", "role":"broll"|"image", "inSec":0, "outSec":0, "keepAudio":false, "narrationIndex":0}
  ],
  "narrationScript": [
    {"text":"...", "startSec":0, "endSec":3.2}
  ],
  "notes": "one short sentence on the story you wrote"
}`;

type AssetSummary = {
  id: string;
  kind: 'video' | 'image';
  durationSec: number;
  transcriptPreview?: string;
  wordCount?: number;
  speakerSegments?: Array<{ start: number; end: number; speaker: string }>;
  speakerCoverage?: number;
  analysis?: {
    subject: string;
    isPersonOnCamera: boolean;
    sceneTags: string[];
    bRollFriendly: boolean;
    emotionalTone: string;
    caption: string;
  };
};

function summarize(asset: ProductionAsset): AssetSummary {
  const words = asset.transcript?.words ?? [];
  const preview = words
    .slice(0, 40)
    .map((w) => w.word)
    .join(' ');
  return {
    id: asset.id,
    kind: asset.kind,
    durationSec: asset.durationSec ?? 0,
    transcriptPreview: preview || undefined,
    wordCount: words.length || undefined,
    speakerSegments: asset.diarization?.segments.slice(0, 40).map((s) => ({
      start: s.start,
      end: s.end,
      speaker: s.speaker,
    })),
    speakerCoverage: asset.speakerCoverage ?? undefined,
    analysis: asset.analysis ?? undefined,
  };
}

function buildUserMessage(
  mode: ProductionMode,
  capSeconds: number,
  assets: ProductionAsset[],
  userBrief: string | null | undefined,
): string {
  const summaries = assets.map(summarize);
  // The brief is placed above the mechanical inputs so the LLM anchors on
  // it first. Kept verbatim — no summarization — so the user's own words
  // drive narration tone and editorial angle.
  const briefBlock = userBrief
    ? `USER BRIEF (creative direction — honor tone, subject, and angle):
"""
${userBrief}
"""

`
    : '';
  return `${briefBlock}capSeconds: ${capSeconds}
mode: ${mode}

assets:
${JSON.stringify(summaries, null, 2)}

Produce the timeline JSON now. Output JSON only.`;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

// Post-LLM semantic validation beyond Zod. Mutates `plan` in place to clamp
// small overshoots (LLMs often overshoot durationSec by a fraction of a
// second). Returns an error string only for unrecoverable problems.
function validatePlan(
  plan: ProductionPlan,
  capSeconds: number,
  assets: ProductionAsset[],
): string | null {
  const byId = new Map(assets.map((a) => [a.id, a]));
  let total = 0;
  for (const [i, entry] of plan.timeline.entries()) {
    const asset = byId.get(entry.assetId);
    if (!asset) return `timeline[${i}]: unknown assetId ${entry.assetId}`;
    if (entry.outSec <= entry.inSec) {
      return `timeline[${i}]: outSec (${entry.outSec}) must exceed inSec (${entry.inSec})`;
    }
    if (asset.kind === 'video') {
      const dur = asset.durationSec ?? 0;
      const overshoot = entry.outSec - dur;
      // Tolerate overshoots up to 2s OR 15% of asset duration — clamp the
      // entry rather than reject the whole plan. LLMs commonly miss exact
      // durations by ~0.5–1.5s and the editorial intent is still valid.
      const tolerance = Math.max(2, dur * 0.15);
      if (overshoot > 0 && overshoot <= tolerance) {
        entry.outSec = dur;
        if (entry.outSec <= entry.inSec + 0.1) {
          // Shrinking made the segment too short to be useful — shift inSec back.
          entry.inSec = Math.max(0, dur - Math.max(0.5, entry.outSec - entry.inSec));
        }
      } else if (overshoot > tolerance) {
        return `timeline[${i}]: outSec ${entry.outSec} exceeds asset duration ${dur} by more than ${tolerance.toFixed(1)}s`;
      }
    }
    total += entry.outSec - entry.inSec;
  }
  if (total > capSeconds * 1.15) {
    return `timeline total ${total.toFixed(2)}s exceeds cap ${capSeconds}s by more than 15%`;
  }
  if (plan.mode === 'narrated_story') {
    if (!plan.narrationScript || plan.narrationScript.length === 0) {
      return 'narrated_story: narrationScript is required and must be non-empty';
    }
    for (const [i, beat] of plan.narrationScript.entries()) {
      if (beat.endSec <= beat.startSec) {
        return `narrationScript[${i}]: endSec must exceed startSec`;
      }
    }
  }
  return null;
}

export type ProduceTimelineArgs = {
  mode: ProductionMode;
  capSeconds: number;
  assets: ProductionAsset[];
  // Optional creative brief from the uploader. Passed through to the LLM
  // user message so it can shape ordering, narration tone, and emphasis.
  // Not used by the deterministic fallback (which is intentionally dumb).
  userBrief?: string | null;
};

export async function produceTimeline(args: ProduceTimelineArgs): Promise<ProductionPlan> {
  const plan = await tryLlm(args).catch((err) => {
    console.warn(`produceTimeline: LLM failed, falling back: ${(err as Error).message}`);
    return null;
  });
  if (plan) return plan;
  return buildFallbackPlan(args);
}

async function tryLlm(args: ProduceTimelineArgs): Promise<ProductionPlan | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('produceTimeline: no ANTHROPIC_API_KEY, using fallback');
    return null;
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const system =
    args.mode === 'speaker_montage' ? SPEAKER_MONTAGE_SYSTEM : NARRATED_STORY_SYSTEM;
  const user = buildUserMessage(args.mode, args.capSeconds, args.assets, args.userBrief);

  const start = Date.now();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  const block = response.content[0];
  const text = block && block.type === 'text' ? block.text : '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (err) {
    console.warn(`produceTimeline: non-JSON response: ${(err as Error).message}`);
    return null;
  }
  const result = ProductionPlanSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`produceTimeline: schema mismatch: ${result.error.message.slice(0, 300)}`);
    return null;
  }
  const err = validatePlan(result.data, args.capSeconds, args.assets);
  if (err) {
    console.warn(`produceTimeline: validation failed: ${err}`);
    return null;
  }
  console.log(`produceTimeline: ${args.mode} ${Date.now() - start}ms, ${result.data.timeline.length} entries`);
  return result.data;
}

// Deterministic fallback — used on LLM failure or missing API key. The plan
// is rough but guaranteed to be a valid, renderable timeline.
export function buildFallbackPlan(args: ProduceTimelineArgs): ProductionPlan {
  if (args.mode === 'speaker_montage') {
    return buildSpeakerFallback(args.capSeconds, args.assets);
  }
  return buildNarratedFallback(args.capSeconds, args.assets);
}

function buildSpeakerFallback(capSeconds: number, assets: ProductionAsset[]): ProductionPlan {
  const videos = assets.filter((a) => a.kind === 'video' && (a.durationSec ?? 0) > 0);
  const timeline: TimelineEntry[] = [];
  let remaining = capSeconds;
  // Take from the start of each video in upload order until we fill the cap.
  for (const v of videos) {
    if (remaining <= 0) break;
    const dur = v.durationSec ?? 0;
    const take = Math.min(dur, remaining);
    if (take <= 0.5) continue;
    timeline.push({
      assetId: v.id,
      role: 'speaker',
      inSec: 0,
      outSec: take,
      keepAudio: true,
    });
    remaining -= take;
  }
  if (timeline.length === 0) {
    // No videos — unusual for speaker_montage but still produce a 1-entry plan
    // from the first available asset.
    const any = assets[0];
    if (any) {
      timeline.push({
        assetId: any.id,
        role: any.kind === 'image' ? 'image' : 'broll',
        inSec: 0,
        outSec: Math.min(capSeconds, any.durationSec ?? capSeconds),
        keepAudio: false,
      });
    }
  }
  return {
    mode: 'speaker_montage',
    targetDurationSec: capSeconds,
    timeline,
    notes: 'Deterministic fallback: sequential speaker clips from upload order.',
  };
}

function buildNarratedFallback(capSeconds: number, assets: ProductionAsset[]): ProductionPlan {
  if (assets.length === 0) {
    return {
      mode: 'narrated_story',
      targetDurationSec: capSeconds,
      timeline: [],
      narrationScript: [],
      notes: 'Fallback: no assets.',
    };
  }

  // Aim for ~2.8s per beat (fast short-form pacing) up to 8 beats total.
  const targetBeatSec = 2.8;
  const desiredBeats = Math.min(8, Math.max(3, Math.round(capSeconds / targetBeatSec)));
  const beatDur = capSeconds / desiredBeats;
  const wordsPerBeat = Math.max(6, Math.round(beatDur * 2.5));

  // Build a queue of (asset, inSec) pairs. For long videos, emit two entries
  // with different inSec values so the fallback still feels varied when we
  // have fewer assets than beats. Placement alternates to spread repeats.
  type Slot = { asset: ProductionAsset; inSec: number };
  const slots: Slot[] = [];
  for (const a of assets) {
    const dur = a.durationSec ?? 0;
    if (a.kind === 'video' && dur >= 5 + beatDur) {
      slots.push({ asset: a, inSec: 0 });
      // Second window picked deep into the clip so it looks different.
      const secondIn = Math.max(beatDur + 1, Math.min(dur - beatDur, dur * 0.6));
      slots.push({ asset: a, inSec: secondIn });
    } else {
      slots.push({ asset: a, inSec: 0 });
    }
  }

  const timeline: TimelineEntry[] = [];
  const narrationScript: NarrationBeat[] = [];
  let cursor = 0;
  for (let i = 0; i < desiredBeats; i++) {
    const slot = slots[i % slots.length];
    if (!slot) break;
    const { asset, inSec } = slot;
    const caption =
      asset.analysis?.caption ?? asset.analysis?.subject ?? `A moment from clip ${i + 1}`;
    const text = caption.split(/\s+/).slice(0, wordsPerBeat).join(' ');
    narrationScript.push({ text, startSec: cursor, endSec: cursor + beatDur });
    const actualIn = asset.kind === 'video' ? inSec : 0;
    timeline.push({
      assetId: asset.id,
      role: asset.kind === 'image' ? 'image' : 'broll',
      inSec: actualIn,
      outSec: actualIn + beatDur,
      keepAudio: false,
      narrationIndex: i,
    });
    cursor += beatDur;
  }
  return {
    mode: 'narrated_story',
    targetDurationSec: capSeconds,
    timeline,
    narrationScript,
    notes: 'Deterministic fallback: fast-paced ~2.8s beats, long videos split in two.',
  };
}
