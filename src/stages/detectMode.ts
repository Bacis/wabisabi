import type { ProductionAsset, ProductionMode } from '../shared/productionTypes.js';

// Pure-TS mode detector. Deterministic so the decision is auditable in logs
// — no LLM needed. Looks at aggregate speech coverage, word density, face
// presence, and primary speaker dominance.

export type DetectModeResult = {
  mode: ProductionMode;
  reason: string;
  metrics: {
    videoCount: number;
    imageCount: number;
    totalVideoDurSec: number;
    totalSpeechDurSec: number;
    totalWords: number;
    assetsWithFaces: number;
    speechRatio: number;
    wordsPerSec: number;
    primarySpeakerFraction: number;
  };
};

function assetHasFaces(asset: ProductionAsset): boolean {
  if (!asset.faces) return false;
  const samples = asset.faces.samples ?? [];
  if (samples.length === 0) return false;
  const withFaces = samples.filter((s) => s.faces.length > 0).length;
  // At least 5% of samples should contain a face to count as "face present".
  return withFaces / samples.length >= 0.05;
}

function primarySpeakerFraction(assets: ProductionAsset[]): number {
  const perSpeaker = new Map<string, number>();
  let total = 0;
  for (const a of assets) {
    if (!a.diarization) continue;
    for (const seg of a.diarization.segments) {
      const dur = Math.max(0, seg.end - seg.start);
      perSpeaker.set(seg.speaker, (perSpeaker.get(seg.speaker) ?? 0) + dur);
      total += dur;
    }
  }
  if (total <= 0 || perSpeaker.size === 0) return 0;
  const top = Math.max(...perSpeaker.values());
  return top / total;
}

export function detectMode(assets: ProductionAsset[]): DetectModeResult {
  const videos = assets.filter((a) => a.kind === 'video');
  const images = assets.filter((a) => a.kind === 'image');
  const totalVideoDur = videos.reduce((s, a) => s + (a.durationSec ?? 0), 0);
  const totalWords = videos.reduce((s, a) => s + (a.transcript?.words.length ?? 0), 0);
  const totalSpeechDur = videos.reduce(
    (s, a) => s + (a.speakerCoverage ?? 0) * (a.durationSec ?? 0),
    0,
  );
  const assetsWithFaces = videos.filter(assetHasFaces).length;
  const speechRatio = totalVideoDur > 0 ? totalSpeechDur / totalVideoDur : 0;
  const wordsPerSec = totalVideoDur > 0 ? totalWords / totalVideoDur : 0;
  const primary = primarySpeakerFraction(videos);

  // Primary speaker fraction defaults to 1.0 when diarization unavailable
  // but we still have transcribed speech — that way a single-video upload
  // without HF token still picks speaker_montage if everything else fits.
  const effectivePrimary =
    primary > 0
      ? primary
      : totalWords > 0 && videos.every((v) => !v.diarization || v.diarization.segments.length === 0)
        ? 1.0
        : 0;

  const qualifiesAsSpeaker =
    videos.length > 0 &&
    speechRatio >= 0.55 &&
    wordsPerSec >= 1.5 &&
    assetsWithFaces >= 1 &&
    effectivePrimary >= 0.6;

  const mode: ProductionMode = qualifiesAsSpeaker ? 'speaker_montage' : 'narrated_story';
  const reason = qualifiesAsSpeaker
    ? `speechRatio=${speechRatio.toFixed(2)} wordsPerSec=${wordsPerSec.toFixed(2)} primarySpeaker=${effectivePrimary.toFixed(2)} faces=${assetsWithFaces}`
    : videos.length === 0
      ? 'no videos uploaded'
      : `insufficient speech (speechRatio=${speechRatio.toFixed(2)} wordsPerSec=${wordsPerSec.toFixed(2)} faces=${assetsWithFaces})`;

  return {
    mode,
    reason,
    metrics: {
      videoCount: videos.length,
      imageCount: images.length,
      totalVideoDurSec: totalVideoDur,
      totalSpeechDurSec: totalSpeechDur,
      totalWords,
      assetsWithFaces,
      speechRatio,
      wordsPerSec,
      primarySpeakerFraction: effectivePrimary,
    },
  };
}
