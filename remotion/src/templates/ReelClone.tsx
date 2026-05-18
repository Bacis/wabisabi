import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { evalEnter, getSpec, type AnimPreset } from '../lib/animationPresets';
import { loadFont } from '@remotion/google-fonts/Inter';
// Extra display + editorial fonts so per-tier fontFamily overrides
// actually render the requested font instead of silently falling back
// to sans-serif. The homepage's "Design / cinematic / by talking."
// cocktail uses Instrument Serif (italic) + Onest (bold); we load both
// here so the IMAX preset (and any preset that wants this mix) renders
// at parity with the marketing surface.
import { loadFont as loadInstrumentSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadOnest } from '@remotion/google-fonts/Onest';
import type { FaceData } from '../lib/positioning';
import type {
  CaptionPlan,
  Transcript,
  Word,
  CaptionChunk,
} from '../lib/CaptionLayer';
import {
  FILLER_WORDS,
  VALUE_WORDS,
  applyTransform,
  inferEmphasis,
  isFiller,
  makeItalicMatcher,
  normalize,
  toPalette,
} from '../lib/linguistics';
import { selectChunks } from '../lib/chunking';
import { makeSizing } from '../lib/sizing';
import { pickActiveChunk } from '../lib/motion/activeChunk';
import { pickEntryFrame } from '../lib/motion/wordReveal';
import {
  valueKey as anchorValueKey,
} from '../lib/layout/anchorRules';
import { getLayoutStrategy } from '../lib/layout/registry';
import type { LayoutStrategyId, StrategyInput } from '../lib/layout/types';
import { placementToContainerStyle, resolvePlacement } from '../lib/layout/placement';
import { resolveChunkStyle, type ChunkOverride } from '../lib/styleMerge';
import { CueLayer } from '../audio/CueLayer';
import type { DirectorScript } from '../../../src/shared/director/schema';
import {
  breatheBlurPx,
  crystalLetterTransform,
  flareTextShadow,
  FxFilterDefs,
  getEffectKind,
  isVol03Effect,
  magneticLetterTransform,
  sambaLetterTransform,
  SliceWord,
  type EffectId,
  type FxRequest,
  type Vol03Effect,
} from '../lib/fx';

// Fully StyleSpec-driven caption template. Every visual behavior is
// controlled via styleSpec fields — no hardcoded multipliers, transforms,
// or layout decisions. This allows the automated refinement loop to tune
// all parameters without needing template code changes.
//
// Extended StyleSpec fields read by this template (beyond the standard ones):
//   styleSpec.reel.emphasisStyle           — 'inline-color' | 'block' | 'combined' (default 'combined')
//                                              inline-color: emphasisFill color, no case/size change, stays inline
//                                              block: large uppercase on own line at fillColor (no color change)
//                                              combined: red + uppercase + larger + own line (legacy behavior)
//   styleSpec.reel.emphasisFillRatio       — when set, emphasis word size auto-fits to this fraction
//                                              of the usable line width (overrides emphasisSizeMultiplier)
//   styleSpec.reel.emphasisMaxHeightRatio  — caps emphasis font-size to this fraction of canvas height
//                                              (default 0.20). Prevents huge words from clipping the
//                                              caption stack when the chunk has multiple lines.
//   styleSpec.reel.cascadeTopRatio         — top-line size as fraction of bottom (default 1.0 = no cascade)
//   styleSpec.reel.cascadeBottomRatio      — bottom-line (anchor) size factor (default 1.0)
//                                              When cascadeTopRatio < cascadeBottomRatio, lines progressively
//                                              grow from top to bottom, mimicking the reference reel's stack.
//   styleSpec.reel.multiColorEmphasis      — when true, cycle through emphasisFill palette per emphasis word
//                                              within a chunk (default false: one color per chunk).
//   styleSpec.reel.italicVocabulary        — array of lowercase tokens that should render in italic
//                                              when they appear in a chunk (default []). Used to mimic
//                                              the rare italic-script accent words in some reels
//                                              (e.g. "reasonable").
//   styleSpec.reel.emphasisSizeMultiplier  — fixed size ratio for emphasis words (default 1.0)
//   styleSpec.reel.fillerSizeMultiplier    — size ratio for filler words (default 1.0)
//   styleSpec.reel.emphasisTextTransform   — 'uppercase' | 'lowercase' | 'none' (default 'none')
//   styleSpec.reel.fillerTextTransform     — 'uppercase' | 'lowercase' | 'none' (default 'none')
//   styleSpec.reel.mediumTextTransform     — 'uppercase' | 'lowercase' | 'none' (default 'none')
//   styleSpec.reel.emphasisLineBreak       — whether emphasis words force their own line (default false)
//   styleSpec.reel.emphasisWeight          — font weight for emphasis words (default: same as font.weight)
//   styleSpec.reel.wordReveal              — 'all' | 'progressive' (default 'all')
//   styleSpec.reel.inferEmphasis           — auto-infer emphasis if plan has none (default true; opt out with `false`)
//   styleSpec.reel.columnGapRatio          — gap between words as ratio of baseSize (default 0.2)
//   styleSpec.reel.rowGapRatio             — gap between lines as ratio of baseSize (default 0.05)
//   styleSpec.reel.maxWidthPercent         — max width of text container (default 90)
//   styleSpec.reel.paddingPercent          — horizontal padding (default 6)

loadFont('normal', {
  weights: ['400', '700', '800', '900'],
  subsets: ['latin'],
});
loadFont('italic', {
  weights: ['400', '700', '900'],
  subsets: ['latin'],
});
// Instrument Serif: editorial serif. Italic 400 is the recipe used on
// the homepage hero title for the "Design / cinematic / captions" run.
loadInstrumentSerif('italic', { weights: ['400'], subsets: ['latin'] });
loadInstrumentSerif('normal', { weights: ['400'], subsets: ['latin'] });
// Onest: clean geometric display. Heavy weights for the bold-sans
// "by talking." lane.
loadOnest('normal', { weights: ['700', '800', '900'], subsets: ['latin'] });

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: Record<string, any>;
  /** Optional Director plan. When present, audio cues + typewriter patterns
   *  fire via <CueLayer>. Absent for legacy renders. */
  directorScript?: DirectorScript;
};

export const ReelClone: React.FC<Props> = ({
  videoFile,
  transcript,
  directorScript,
  captionPlan,
  styleSpec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: frameWidth, height: frameHeight } = useVideoConfig();
  const t = frame / fps;

  // --- Read ALL config from styleSpec ---
  // Per-chunk style resolution: when styleSpec.chunkOverrides[] is set
  // (e.g. the Director planner emits one entry per scene group), the
  // active chunk's effective spec is the base spec merged with the
  // overrides whose range covers activeChunkIdx. We pre-compute just
  // enough base config to pick the active chunk, then read everything
  // else from the per-chunk resolved spec so size / color / layout /
  // tiers / placement can vary per group.
  const baseLayoutForChunking = (styleSpec.layout ?? {}) as Record<string, any>;
  const baseAnimForChunking = (styleSpec.animation ?? {}) as Record<string, any>;
  const _maxPerLineForChunking = baseLayoutForChunking.maxWordsPerLine ?? 4;
  const _tailMsForChunking = baseAnimForChunking.tailMs ?? 200;
  const _preChunks: CaptionChunk[] = selectChunks(captionPlan, transcript.words, {
    maxPerLine: _maxPerLineForChunking,
  });
  const _preActiveChunkIdx = pickActiveChunk(_preChunks, t, _tailMsForChunking / 1000);
  const _chunkOverrides = styleSpec.chunkOverrides as ChunkOverride[] | undefined;
  const effectiveSpec =
    _preActiveChunkIdx >= 0
      ? resolveChunkStyle(_preActiveChunkIdx, styleSpec, _chunkOverrides)
      : styleSpec;
  const font = effectiveSpec.font ?? {};
  const color = effectiveSpec.color ?? {};
  const layout = effectiveSpec.layout ?? {};
  const anim = effectiveSpec.animation ?? {};
  const reel = effectiveSpec.reel ?? {};
  // Optional editor-controlled bounding box for the caption container.
  // When set, overrides the default top/bottom-anchored layout so the
  // user can place captions visually via the on-preview gizmo.
  const captionTransform: { x: number; y: number; w: number; h: number; rot: number } | null =
    styleSpec.captionTransform ?? null;

  // Font
  const fontFamily = font.family ?? 'Inter';
  const nominalSize = font.size ?? 64;
  const baseSize = nominalSize * (frameWidth / 1080);
  const baseWeight = font.weight ?? 800;
  const baseLetterSpacing = font.letterSpacing ?? 0;
  const baseTextTransform = font.textTransform ?? 'none';

  // Colors
  const fillColor = color.fill ?? '#ffffff';
  const strokeColor = color.stroke ?? '#000000';
  const strokeWidth = color.strokeWidth ?? 0;
  const palette = toPalette(color.emphasisFill, fillColor);

  // Layout
  const maxPerLine = layout.maxWordsPerLine ?? 4;
  const safeMargin = layout.safeMargin ?? 0.15;
  // Generalized placement model — reads `layout.placement` if present,
  // otherwise maps from legacy `layout.position` + `layout.align`. Old
  // presets continue to render with byte-faithful CSS via this helper.
  const placement = resolvePlacement(styleSpec);
  const align = placement.alignment;

  // Animation. `preset` selects one of the portable entry specs (ported from
  // pixel-point/animate-text); each spec embeds its own duration, easing,
  // stagger, and target unit. The renderer interprets the spec via evalEnter
  // for every word — the bespoke spring path is gone, replaced by the same
  // engine that drives PopWords / SingleWord / CaptionDesigner.
  const animPreset = anim.preset as AnimPreset | undefined;
  const animSpec = getSpec(animPreset);
  const tailMs = anim.tailMs ?? 200;

  // Reel-specific config (all StyleSpec-driven, all with safe defaults)
  const emphasisStyleRaw = (reel.emphasisStyle ?? 'combined') as
    | 'combined' | 'block' | 'inline-color';
  const emphasisFillRatio: number | null =
    typeof reel.emphasisFillRatio === 'number' ? reel.emphasisFillRatio : null;
  const emphasisMaxHeightRatio: number =
    typeof reel.emphasisMaxHeightRatio === 'number' ? reel.emphasisMaxHeightRatio : 0.2;
  const cascadeTopRatio: number =
    typeof reel.cascadeTopRatio === 'number' ? reel.cascadeTopRatio : 1.0;
  const cascadeBottomRatio: number =
    typeof reel.cascadeBottomRatio === 'number' ? reel.cascadeBottomRatio : 1.0;
  const multiColorEmphasis: boolean = reel.multiColorEmphasis === true;
  // Per-tier styling overrides. Editor surfaces these as "Primary emphasis"
  // (palette index 0), "Secondary emphasis" (palette index 1) and "Italic
  // accent" tabs. Each tier may override fill (solid hex with alpha or a
  // linear gradient {type, angle, stops}), fontFamily, fontWeight,
  // sizeMultiplier, strokeColor, strokeWidth — anything unset falls back
  // to the base (cascade / palette / fill / weight / etc.) so old presets
  // keep rendering identically.
  type GradientFillObj = {
    type?: 'linear';
    angle?: number;
    stops: Array<{ pos: number; color: string }>;
  };
  type TierFill = string | GradientFillObj;
  type EffectId =
    | 'none' | 'samba' | 'breathe' | 'flare' | 'crystal' | 'magnetic'
    | 'resonance' | 'inflation' | 'slice' | 'ferro' | 'shockwave';
  type TierStyle = {
    fill?: TierFill;
    fontFamily?: string;
    fontWeight?: number;
    // Force this tier's words to a specific font-style regardless of
    // italicVocabulary / italicAccentRate detection. Lets the agent
    // express recipes like "palette[0] is yellow ITALIC serif" alongside
    // "palette[1] is bold UPRIGHT sans" — without this override,
    // palette-tier words always inherit fontStyle from the italic
    // detection, which makes mixed italic/upright tier sets impossible.
    fontStyle?: 'normal' | 'italic';
    sizeMultiplier?: number;
    strokeColor?: string;
    strokeWidth?: number;
    // Motion FX applied to words rendered at this tier. Adapted from FX Lab
    // Vol.02 — see web/src/lib/templateDescriptors/reel-clone.ts for the
    // picker. Per-letter effects (samba/crystal/magnetic) split the word
    // into character spans; full-word effects (breathe/flare) wrap once.
    // Vol.03 effects (resonance/inflation/slice/ferro/shockwave) are
    // SVG-filter-based body distortions driven by `intensity` (0..1).
    effect?: EffectId;
    // Single 0..1 dial driving both amplitude and rate of the Vol.03
    // intensity-driven effects. Ignored for Vol.02 effects (none/samba/etc).
    intensity?: number;
  };
  const tiers = (reel.tiers ?? {}) as {
    byPaletteIndex?: Record<string, TierStyle>;
    italic?: TierStyle;
  };
  // Italic style is now a generic *rate*, not a specific vocab list. The
  // preset's italicAccentRate (0..1) declares what fraction of qualifying
  // emphasis-style words the source reel rendered italic. We replicate that
  // density deterministically on the input transcript: hash each candidate
  // word and italicize the bottom italicAccentRate fraction. Same word
  // always gets the same treatment, so the result is stable across re-renders
  // but distributed naturally across the video.
  const isItalicWord = makeItalicMatcher({
    italicAccentRate: typeof reel.italicAccentRate === 'number' ? reel.italicAccentRate : 0,
    italicVocabulary: Array.isArray(reel.italicVocabulary) ? reel.italicVocabulary : [],
  });
  const emphasisSizeMultiplier = reel.emphasisSizeMultiplier ?? 1.0;
  const fillerSizeMultiplier = reel.fillerSizeMultiplier ?? 1.0;
  // Resolve emphasis behavior from emphasisStyle. Individual reel.* fields can
  // still override (e.g. user sets emphasisStyle:'block' but explicitly opts
  // out of line break). Switch sets the *defaults* per mode.
  const styleDefaults =
    emphasisStyleRaw === 'inline-color'
      ? { useColor: true, transform: baseTextTransform, lineBreak: false, sizeRule: 'fixed' as const }
      : emphasisStyleRaw === 'block'
        ? { useColor: false, transform: 'uppercase' as const, lineBreak: true, sizeRule: 'fit' as const }
        : { useColor: true, transform: 'uppercase' as const, lineBreak: true, sizeRule: 'fixed' as const };
  const emphasisUsesColor = reel.emphasisUsesColor ?? styleDefaults.useColor;
  const emphasisTextTransform = reel.emphasisTextTransform ?? styleDefaults.transform;
  const fillerTextTransform = reel.fillerTextTransform ?? baseTextTransform;
  const mediumTextTransform = reel.mediumTextTransform ?? baseTextTransform;
  const emphasisLineBreak = reel.emphasisLineBreak ?? styleDefaults.lineBreak;
  const emphasisWeight = reel.emphasisWeight ?? baseWeight;
  const wordReveal = reel.wordReveal ?? 'all';
  // Default ON: when the caption plan has no emphasis flags (LLM enrich
  // failed, plan never ran, or every word is filler), the renderer falls
  // back to a heuristic so themes' primary/secondary tiers still fire.
  // A preset can still opt out with `reel.inferEmphasis: false`.
  const doInferEmphasis = reel.inferEmphasis ?? true;
  const columnGapRatio = reel.columnGapRatio ?? 0.2;
  const rowGapRatio = reel.rowGapRatio ?? 0.05;
  const maxWidthPercent = reel.maxWidthPercent ?? 90;
  const paddingPercent = reel.paddingPercent ?? 6;

  // Computed sizes
  const sizeEmphasis = baseSize * emphasisSizeMultiplier;
  const sizeMedium = baseSize;
  const sizeFiller = baseSize * fillerSizeMultiplier;

  const { usableWidth: USABLE_WIDTH, charAdvance: CHAR_ADVANCE, maxSizeForWord } = makeSizing({
    frameWidth,
    maxWidthPercent,
    charAdvance: styleSpec.charAdvance,
  });

  // Chunks + active-chunk pick reuse the values computed earlier (the
  // per-chunk effectiveSpec needed activeChunkIdx, so the work happens
  // before the styling reads). Re-binding here keeps the downstream
  // names readable.
  const chunks = _preChunks;
  const activeChunkIdx = _preActiveChunkIdx;

  if (activeChunkIdx < 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        {videoFile && (
          // objectFit: cover so horizontal source clips fill the 9:16
          // canvas (cropping left/right) instead of letterboxing
          // top-aligned with a black tail. Vertical 9:16 sources are
          // unaffected since they already match the canvas aspect.
          <OffthreadVideo
            src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </AbsoluteFill>
    );
  }

  const activeChunk = chunks[activeChunkIdx]!;
  const emphasisColor = palette[activeChunkIdx % palette.length] ?? fillColor;

  // Fast-speech adaptive clamp: cap the per-word entry animation at ~35% of
  // the current chunk's on-screen time so even short chunks resolve before
  // the next one rolls in. Computed from word timings — preset durations
  // are a CEILING, never extended. Floor of 0.04s prevents zero-duration
  // animations on degenerate (single-frame) chunks.
  const chunkAnimFitFraction = 0.35;
  const chunkAnimFloorSec = 0.04;
  const chunkOnScreenSec =
    activeChunk.words.length > 0
      ? activeChunk.words[activeChunk.words.length - 1]!.end +
        tailMs / 1000 -
        activeChunk.words[0]!.start
      : 0;
  const maxEntryDurSec = Math.max(chunkAnimFloorSec, chunkOnScreenSec * chunkAnimFitFraction);

  // Emphasis flags
  const hasAnyEmphasis = activeChunk.emphasis.some((e) => e === true);
  const effectiveEmphasis: boolean[] =
    hasAnyEmphasis ? activeChunk.emphasis
    : doInferEmphasis ? inferEmphasis(activeChunk.words)
    : activeChunk.emphasis;

  // Position + alignment styles, derived from the resolved Placement.
  // For legacy presets (no layout.placement, no offsets) this emits the
  // exact same CSS as the pre-refactor inline conditional did.
  const { positionStyle, justifyContent } = placementToContainerStyle(
    placement,
    safeMargin,
  );

  // Vol.03 filter requests — one filter per (tierKey, effect) pair that's
  // configured. Slice glitch is structural, not filter-based, so it's
  // excluded here. Filter ids are referenced by the per-word render branch.
  const fxRequests: FxRequest[] = [];
  const fxRequestKeys = new Set<string>();
  const pushFxRequest = (tierKey: string, tier: TierStyle | undefined): void => {
    if (!tier) return;
    const eff = tier.effect;
    if (!isVol03Effect(eff)) return;
    const id = `fx-${tierKey}-${eff}`;
    if (fxRequestKeys.has(id)) return;
    fxRequestKeys.add(id);
    const intensity = typeof tier.intensity === 'number' ? tier.intensity : 0.5;
    const tierFillHex = typeof tier.fill === 'string'
      ? tier.fill
      : (palette[0] ?? fillColor);
    fxRequests.push({ id, effect: eff, intensity, tierFillHex });
  };
  if (tiers.byPaletteIndex) {
    for (const [k, v] of Object.entries(tiers.byPaletteIndex)) {
      pushFxRequest(`p${k}`, v);
    }
  }
  pushFxRequest('italic', tiers.italic);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoFile && (
        <OffthreadVideo
          src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {directorScript && (
        <CueLayer
          script={directorScript}
          wordStartTimesSec={transcript.words.map((w) => w.start)}
          wordsText={transcript.words.map((w) => w.word)}
        />
      )}
      <FxFilterDefs requests={fxRequests} frameSec={t} />
      {effectiveSpec.visibility !== 'hidden' && (
      <div
        data-caption-container
        style={
          captionTransform
            ? {
                position: 'absolute',
                // Use the composition's actual width/height (set by
                // calculateMetadata from props.videoMeta) so horizontal
                // sources don't get caption positions clamped against
                // the legacy 1080×1920 baseline.
                left: `${(captionTransform.x / frameWidth) * 100}%`,
                top: `${(captionTransform.y / frameHeight) * 100}%`,
                width: `${(captionTransform.w / frameWidth) * 100}%`,
                height: `${(captionTransform.h / frameHeight) * 100}%`,
                transform: `rotate(${captionTransform.rot}deg)`,
                transformOrigin: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent,
                padding: `0 ${paddingPercent}%`,
              }
            : {
                position: 'absolute',
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent,
                padding: `0 ${paddingPercent}%`,
                ...positionStyle,
              }
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
            rowGap: `${baseSize * rowGapRatio}px`,
            maxWidth: `${maxWidthPercent}%`,
          }}
        >
          {(() => {
            // Per-chunk override resolution. Director plans land as
            // styleSpec.chunkOverrides entries — one per scene group, with
            // reel.layout.strategy set from the group's role default. The
            // renderer's other cascade-stack parameters stay at the base
            // level so cascade math doesn't reflow mid-stream when a
            // non-cascade group runs.
            const chunkOverrides = (styleSpec.chunkOverrides as ChunkOverride[] | undefined);
            const effectiveSpec = resolveChunkStyle(activeChunkIdx, styleSpec, chunkOverrides);
            const effectiveReel = (effectiveSpec.reel ?? reel) as Record<string, unknown>;
            const effectiveLayout = (effectiveReel.layout as { strategy?: string } | undefined);
            const strategyId: LayoutStrategyId =
              (effectiveLayout?.strategy as LayoutStrategyId | undefined) ?? 'cascade-stack';
            const strategyInput: StrategyInput = {
              chunk: activeChunk,
              effectiveEmphasis,
              baseSize,
              frameWidth,
              frameHeight,
              usableWidth: USABLE_WIDTH,
              charAdvance: CHAR_ADVANCE,
              maxSizeForWord,
            };
            const plan = getLayoutStrategy(strategyId).computeLayout(
              strategyInput,
              {
                maxPerLine,
                columnGapRatio,
                cascadeTopRatio,
                cascadeBottomRatio,
                emphasisFillRatio,
                emphasisMaxHeightRatio,
                emphasisSizeMultiplier,
                fillerSizeMultiplier,
                sizeRuleIsFit: styleDefaults.sizeRule === 'fit',
                emphasisLineBreak,
              },
            );
            // Alias kept so downstream `lines.length` references inside the
            // per-word render still resolve. The renderer only reads layout
            // output; all layout math lives in lib/layout/cascadeStack.
            const lines = plan.lines;

            // Track emphasis count for multi-color cycling.
            let emphasisSeen = 0;

            return lines.map((lineData, lineIdx) => {
              const { entries, lineFactor, lineScale, cascadeBaseLine } = lineData;
              return (
                <div
                  key={lineIdx}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent,
                    columnGap: `${cascadeBaseLine * lineScale * columnGapRatio}px`,
                  }}
                >
                  {entries.map(({ wordIdx: i, sizeHint, isAnchorBlock: anchorBlock }) => {
                    const w = activeChunk.words[i]!;
                    const isEmphasis = effectiveEmphasis[i] ?? false;
                    const filler = !isEmphasis && isFiller(w.word);

                    const wordStartFrame = Math.floor(w.start * fps);
                    // Don't unmount unrevealed words — that would collapse
                    // their flex slot and the visible row would re-center /
                    // re-size as later words arrive ("push" effect). Instead
                    // we leave the element in the DOM so layout reserves the
                    // final slot from the chunk's first frame; opacity/scale
                    // (transform doesn't affect CSS layout) handle the
                    // visual reveal once the word's start time hits.
                    const entryFrame = pickEntryFrame(wordReveal as 'progressive' | 'all' | undefined, wordStartFrame, activeChunk, fps);
                    // Each unit (word OR character, depending on the spec
                    // target) animates from this anchor time. For per-word
                    // or whole specs we use the word's own entry; for
                    // per-character specs we offset by charIndex × stagger
                    // inside the per-letter render path below.
                    const entryAnchorSec = entryFrame / fps;
                    const wordEntry = evalEnter(animSpec, t, entryAnchorSec, maxEntryDurSec);
                    const opacity = wordEntry.opacity;
                    const entryTransform = wordEntry.transform === 'none' ? '' : wordEntry.transform;
                    const entryFilter = wordEntry.filter;
                    const isPerCharSpec = animSpec.target === 'per-character';

                    // Position-aware emphasis treatment:
                    //   anchor block = emphasis on its own line at the bottom
                    //                  → white, uppercase (per spec), width-fit size
                    //   inline color = emphasis anywhere else → palette color,
                    //                  no case change, no size change
                    const wordKeyEarly = anchorValueKey(w.word);
                    // Anchor-block flag and pre-shrink size hint come from
                    // the LayoutPlan (lib/layout/cascadeStack). The renderer
                    // only multiplies the line-level shrink in.
                    const isAnchorBlock = anchorBlock;
                    // Only italicize if NOT an anchor-block candidate. This
                    // prevents big anchor words like REALITY/CHANGES/TIME
                    // from being italicized away from their intended block
                    // treatment via the rate-based italic selection.
                    const wordIsItalic = !isAnchorBlock && isItalicWord(wordKeyEarly);
                    const size = sizeHint * lineScale;

                    // Color: anchor block keeps base fill (white), inline
                    // emphasis uses palette (cycles when multiColorEmphasis).
                    // Cycle math: within-chunk counter (emphasisSeen) +
                    // chunk index. Without the chunk-level shift, chunks
                    // with one emphasis word would all land on palette[0]
                    // and the rest of the palette would never appear.
                    let resolvedColor = fillColor;
                    const paletteIdx = isEmphasis && !isAnchorBlock
                      ? (emphasisSeen + activeChunkIdx) % palette.length
                      : -1;
                    if (isEmphasis && !isAnchorBlock) {
                      resolvedColor = multiColorEmphasis
                        ? palette[paletteIdx] ?? emphasisColor
                        : emphasisColor;
                    } else if (isEmphasis && isAnchorBlock && emphasisUsesColor) {
                      // Legacy 'combined' style still wants colored anchor.
                      resolvedColor = emphasisColor;
                    }
                    if (isEmphasis) emphasisSeen++;

                    // Transform: only the anchor block gets the emphasis
                    // transform (uppercase). Inline emphasis keeps lowercase
                    // so it sits naturally in the line ("I was 26", not "I WAS 26").
                    const transform = isAnchorBlock
                      ? emphasisTextTransform
                      : filler ? fillerTextTransform : mediumTextTransform;
                    const text = applyTransform(w.word, transform);
                    const baseWordWeight = isAnchorBlock ? emphasisWeight : baseWeight;
                    // Italic if word is in italicVocabulary (script-style accent).
                    // Italic overrides any color emphasis — reference reels render
                    // italic accent words in plain white, with italic carrying the
                    // visual emphasis instead of color.
                    const detectedFontStyle: 'italic' | 'normal' = wordIsItalic ? 'italic' : 'normal';
                    const baseFinalColor = wordIsItalic ? fillColor : resolvedColor;

                    // Tier override resolution. Italic tier wins over palette
                    // tier (an italic word isn't simultaneously "yellow" or
                    // "red" — italic is its own visual lane).
                    const tier: TierStyle | undefined = wordIsItalic
                      ? tiers.italic
                      : (paletteIdx >= 0
                          ? tiers.byPaletteIndex?.[String(paletteIdx)]
                          : undefined);
                    const tierFontFamily = tier?.fontFamily ?? fontFamily;
                    const tierFontWeight =
                      typeof tier?.fontWeight === 'number' ? tier.fontWeight : baseWordWeight;
                    // Tier's explicit fontStyle wins over the italicVocab
                    // detection so recipes can mix italic + upright tiers.
                    const fontStyle: 'italic' | 'normal' =
                      tier?.fontStyle === 'italic' || tier?.fontStyle === 'normal'
                        ? tier.fontStyle
                        : detectedFontStyle;
                    const tierSizeMul =
                      typeof tier?.sizeMultiplier === 'number' ? tier.sizeMultiplier : 1.0;
                    const tierStrokeColor = tier?.strokeColor ?? strokeColor;
                    const tierStrokeWidth =
                      typeof tier?.strokeWidth === 'number' ? tier.strokeWidth : strokeWidth;
                    const adjustedSize = size * tierSizeMul;
                    // Per-tier motion FX. Full-word effects (none/breathe/
                    // flare) keep the single span and use the existing
                    // entry spring; per-letter effects (samba/crystal/
                    // magnetic) split the word and drive each letter's
                    // transform/opacity from FX-Lab math (the spring
                    // entry is bypassed for per-letter so the effect math
                    // owns the motion). Vol.03 body-distortion effects
                    // (resonance/inflation/ferro/shockwave) attach
                    // an SVG filter via url(...) and keep the single span;
                    // slice glitch is structural (10 banded copies) and
                    // routes to <SliceWord/>.
                    const tierEffect: EffectId = (tier?.effect as EffectId) ?? 'none';
                    // Effect routing now flows through the registry —
                    // adding a new effect = registering it once in
                    // lib/fx/registry.ts, no changes here.
                    const effectKind = getEffectKind(tierEffect);
                    const isPerLetterEffect = effectKind === 'per-letter';
                    const isFilterEffect = effectKind === 'svg-filter';
                    const isStructuralEffect = effectKind === 'structural';
                    const tierIntensity =
                      typeof tier?.intensity === 'number' ? tier.intensity : 0.5;
                    const tierKey: string | null = wordIsItalic
                      ? 'italic'
                      : (paletteIdx >= 0 ? `p${paletteIdx}` : null);
                    const elapsedMs = ((frame - entryFrame) / fps) * 1000;
                    const nowMs = (frame / fps) * 1000;

                    // Tier fill: solid hex (with optional alpha) or linear
                    // gradient. Gradient gets painted via background-clip:text;
                    // solid sets `color` directly. When tier doesn't override,
                    // fall back to the existing per-word resolved color.
                    const tierFill = tier?.fill;
                    const isGradient =
                      tierFill && typeof tierFill === 'object' && Array.isArray((tierFill as any).stops);
                    const fillStyles: React.CSSProperties = isGradient
                      ? {
                          backgroundImage: (() => {
                            const g = tierFill as GradientFillObj;
                            const sortedStops = g.stops
                              .slice()
                              .sort((a, b) => a.pos - b.pos)
                              .map((s) => `${s.color} ${(s.pos * 100).toFixed(2)}%`)
                              .join(', ');
                            return `linear-gradient(${g.angle ?? 90}deg, ${sortedStops})`;
                          })(),
                          backgroundClip: 'text',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          color: 'transparent',
                        }
                      : {
                          color: typeof tierFill === 'string' ? tierFill : baseFinalColor,
                        };

                    // Build the per-character outer styles common to both
                    // rendering branches.
                    const fontStyles: React.CSSProperties = {
                      fontFamily: `"${tierFontFamily}", sans-serif`,
                      fontWeight: tierFontWeight,
                      fontStyle,
                      fontSize: `${adjustedSize}px`,
                      lineHeight: 1.0,
                      letterSpacing: baseLetterSpacing ? `${baseLetterSpacing}px` : undefined,
                      WebkitTextStroke: tierStrokeWidth > 0
                        ? `${tierStrokeWidth}px ${tierStrokeColor}`
                        : undefined,
                      paintOrder: tierStrokeWidth > 0 ? 'stroke fill' : undefined,
                      display: 'inline-block',
                      whiteSpace: 'nowrap',
                    };

                    // Slice glitch — structural, not filter-based. Render
                    // 10 stacked clip-banded copies via <SliceWord/>. Bypasses
                    // both the !isPerLetterEffect span path and the per-letter
                    // path (slice is its own rendering universe).
                    if (isStructuralEffect && tierKey != null) {
                      const sliceColor =
                        typeof tierFill === 'string' ? tierFill : baseFinalColor;
                      return (
                        <SliceWord
                          key={i}
                          text={text}
                          intensity={tierIntensity}
                          frameSec={t}
                          fontStyles={fontStyles}
                          fillStyles={fillStyles}
                          baseColor={typeof sliceColor === 'string' ? sliceColor : fillColor}
                          transform={entryTransform}
                          filter={entryFilter}
                          opacity={opacity}
                        />
                      );
                    }

                    // Full-word effects path: single span when the spec target
                    // is whole / per-word (and no per-letter FX is active),
                    // augmented with breathe blur, flare text-shadow, or a
                    // Vol.03 filter url() reference. The entry transform/
                    // filter from evalEnter compose with the FX style.
                    if (!isPerLetterEffect && !isPerCharSpec) {
                      const wordExtras: React.CSSProperties = {};
                      // Composable scale append — inflation wants to layer a
                      // breathing scale on top of the entry transform.
                      let extraTransform = '';
                      if (tierEffect === 'breathe') {
                        wordExtras.filter = `blur(${breatheBlurPx(elapsedMs).toFixed(2)}px)`;
                      } else if (tierEffect === 'flare') {
                        // Flare color: use solid tier fill if available, else
                        // a cyan default that matches FX Lab Vol.02 demo.
                        const flareColor =
                          typeof tierFill === 'string' ? tierFill
                          : (typeof baseFinalColor === 'string' ? baseFinalColor : '#6ba5ff');
                        wordExtras.textShadow = flareTextShadow(elapsedMs, flareColor);
                      } else if (isFilterEffect && tierKey != null) {
                        wordExtras.filter = `url(#fx-${tierKey}-${tierEffect})`;
                        if (tierEffect === 'inflation') {
                          const I = Math.max(0, Math.min(1, tierIntensity));
                          const breathRate = 1.6 + I * 3.0;
                          const breathPhase = Math.sin(t * breathRate);
                          extraTransform = ` scale(${(1 + breathPhase * I * 0.04).toFixed(4)})`;
                        }
                      }
                      // FX filter wins over the entry blur filter when both
                      // would apply — Vol.03 filters are the dominant visual.
                      const finalFilter = wordExtras.filter ?? entryFilter;
                      const composedTransform = (entryTransform + extraTransform).trim();
                      return (
                        <span
                          key={i}
                          style={{
                            ...fontStyles,
                            ...fillStyles,
                            ...wordExtras,
                            filter: finalFilter,
                            transform: composedTransform.length > 0 ? composedTransform : undefined,
                            transformOrigin: 'left baseline',
                            opacity,
                          }}
                        >
                          {text}
                        </span>
                      );
                    }

                    // Per-character spec path (and no per-letter FX): split
                    // the word into letter spans, each anchored to
                    // wordStart + ci × spec.enter.stagger_ms. This is what
                    // turns soft-blur-in / per-character-rise / bottom-up-
                    // letters into a real per-letter cascade on reel-clone.
                    if (!isPerLetterEffect && isPerCharSpec) {
                      const chars = Array.from(text);
                      const charStaggerSec = animSpec.enter.stagger_ms / 1000;
                      return (
                        <span
                          key={i}
                          style={{
                            ...fontStyles,
                            ...fillStyles,
                            display: 'inline-flex',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {chars.map((ch, ci) => {
                            const charAnchor = entryAnchorSec + ci * charStaggerSec;
                            const cf = evalEnter(animSpec, t, charAnchor, maxEntryDurSec);
                            return (
                              <span
                                key={ci}
                                style={{
                                  display: 'inline-block',
                                  transform: cf.transform === 'none' ? undefined : cf.transform,
                                  transformOrigin: 'left baseline',
                                  opacity: cf.opacity,
                                  filter: cf.filter,
                                  // Each letter span inherits font/fill from
                                  // the wrapper for non-gradient fills; for
                                  // gradient fills we duplicate so each glyph
                                  // paints (background-clip:text on a parent
                                  // doesn't propagate to children).
                                  ...(isGradient ? fillStyles : null),
                                  whiteSpace: 'pre',
                                }}
                              >
                                {ch === ' ' ? ' ' : ch}
                              </span>
                            );
                          })}
                        </span>
                      );
                    }

                    // Per-letter effects path: split the word into character
                    // spans, each with its own transform/opacity. Outer span
                    // carries the typography + fill; the spring entry is
                    // intentionally NOT applied here — the effect's own
                    // math (samba clave / crystal shatter / magnetic snap)
                    // is the entry animation.
                    const chars = Array.from(text);
                    return (
                      <span
                        key={i}
                        style={{
                          ...fontStyles,
                          // For gradient fills, propagate to children: each
                          // char gets the same gradient via inherit; with
                          // background-clip:text on the parent, child glyphs
                          // wouldn't paint, so we duplicate the styles per char.
                          color: typeof tierFill === 'string' ? tierFill : (isGradient ? undefined : baseFinalColor),
                        }}
                      >
                        {chars.map((ch, li) => {
                          const result =
                            tierEffect === 'samba' ? sambaLetterTransform(li, elapsedMs, nowMs)
                            : tierEffect === 'crystal' ? crystalLetterTransform(li, elapsedMs)
                            : magneticLetterTransform(li, elapsedMs);
                          return (
                            <span
                              key={li}
                              style={{
                                display: 'inline-block',
                                transform: result.transform,
                                transformOrigin: 'center center',
                                opacity: result.opacity,
                                // Per-letter must re-apply gradient styles
                                // since background-clip:text on parent
                                // doesn't propagate to children's text.
                                ...(isGradient ? fillStyles : null),
                                whiteSpace: 'pre',
                              }}
                            >
                              {ch === ' ' ? ' ' : ch}
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      </div>
      )}
    </AbsoluteFill>
  );
};
