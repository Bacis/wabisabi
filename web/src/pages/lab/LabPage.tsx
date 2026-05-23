// Wabisabi Caption Lab — Composer.
//
// Canva-style layered editor for caption "setups": the block + its individual
// words live as layers in a left rail, the canvas in the middle hosts the
// real-CSS preview with react-moveable handles on the current selection, and
// the right rail is the properties panel for the selected node.
//
// The toolbar drives the high-level rolling actions:
//   • Reroll — pick a fresh theme + scene + fx + fonts and replan every word.
//             Wipes manual edits and auto-selects the block, so the
//             Properties panel immediately shows what was just rolled.
//   • Play   — toggle the CSS keyframe animations on the stage.
//   • Copy JSON — serialize the current composition to clipboard via the
//             existing exportPreset path. This is purely a design playground;
//             no server-side persistence.
//
// Per-word free transforms (x/y/rot/scale) are applied via the standalone CSS
// `translate` / `rotate` / `scale` properties (NOT `transform`) so they
// compose with the keyframes in animations.css instead of clobbering them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import './animations.css';
import styles from './LabPage.module.css';
import { ComposerToolbar } from './components/ComposerToolbar';
import { LayerTree } from './components/LayerTree';
import { ComposerCanvas } from './components/ComposerCanvas';
import { PropertiesPanel } from './components/PropertiesPanel';
import type { Selection } from './components/selection';
import { roll as rollFn, applyPunchOverride } from './engine/randomizer';
import type { LabRoll } from './engine/randomizer';
import { usePlayback } from './engine/usePlayback';
import { exportPreset } from './engine/exportPreset';
import type {
  BlockTransform,
  WordOverride,
  WordOverrides,
  WordTransform,
} from './engine/exportPreset';
import { DEFAULT_BLOCK_TRANSFORM } from './engine/exportPreset';
import { PAIRING_BY_ID, loadCaptionFonts } from './data/fonts';
import { FX_BY_ID } from './data/effects';
import type { WordFxId } from './data/effects';
import { createTheme } from '@/lib/api';

export function LabPage() {
  // One-time font sheet injection (caption-specific Google Fonts).
  useEffect(() => {
    loadCaptionFonts();
  }, []);

  // Roll state — single source of truth for what's on stage. mountKey bumps
  // on every reroll / new-roll so the LabStage subtree remounts and CSS
  // animations replay from frame 0.
  const [roll, setRoll] = useState<LabRoll>(() => rollFn());
  const [overrides, setOverrides] = useState<WordOverrides>({});
  const [blockTransform, setBlockTransform] = useState<BlockTransform>(
    DEFAULT_BLOCK_TRANSFORM,
  );
  // Open on the block so the Properties panel shows what was auto-rolled.
  const [selection, setSelection] = useState<Selection>({ kind: 'block' });
  // Override which word index renders as PUNCH. null = use the scene's
  // natural punch (whatever the randomizer planned). Reset on every reroll.
  const [punchOverride, setPunchOverride] = useState<number | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [playing, setPlaying] = useState(true);

  const remount = useCallback(() => setMountKey((k) => k + 1), []);

  // Full roll — wipes all manual edits and auto-selects the block so the
  // Properties panel populates with the freshly-rolled theme/scene/fx/fonts.
  // Keeps playing=true so the user sees the new roll animate.
  const onReroll = useCallback(() => {
    setOverrides({});
    setBlockTransform(DEFAULT_BLOCK_TRANSFORM);
    setPunchOverride(null);
    setRoll(rollFn());
    setSelection({ kind: 'block' });
    setPlaying(true);
    remount();
  }, [remount]);

  // Promote a word to PUNCH (and demote whatever was punch before). Render-
  // time only — the rolled words array stays intact, just transformed via
  // applyPunchOverride when building displayRoll below.
  const onSetPunch = useCallback(
    (idx: number) => {
      setPunchOverride(idx);
      remount();
    },
    [remount],
  );

  // Effective roll used by every consumer (LayerTree, Canvas, Properties).
  // Identical to roll when no override is set.
  const displayRoll = useMemo<LabRoll>(() => {
    if (punchOverride === null) return roll;
    return {
      ...roll,
      words: applyPunchOverride(roll.words, punchOverride, roll.bodyFx.id),
    };
  }, [roll, punchOverride]);

  // Per-word patch — merges into the existing override.
  const onSetWordOverride = useCallback(
    (idx: number, patch: WordOverride | null) => {
      setOverrides((prev) => {
        if (patch === null) {
          const { [idx]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [idx]: { ...prev[idx], ...patch } };
      });
    },
    [],
  );

  const onClearWordOverride = useCallback((idx: number) => {
    setOverrides((prev) => {
      const { [idx]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // Moveable writes here from drag/rotate/scale; wraps a transform patch
  // through the usual override merge.
  const onChangeWordTransform = useCallback(
    (idx: number, t: WordTransform) => {
      setOverrides((prev) => ({
        ...prev,
        [idx]: { ...prev[idx], transform: t },
      }));
    },
    [],
  );

  const onChangeBlockTransform = useCallback(
    (patch: Partial<BlockTransform>) => {
      setBlockTransform((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  const onResetBlockTransform = useCallback(() => {
    setBlockTransform(DEFAULT_BLOCK_TRANSFORM);
  }, []);

  // Swap to a different curated font pairing without touching the roll's
  // theme, accents, or per-word plans. CSS vars on LabStage update reactively
  // so the new families appear on the next frame while keyframes keep playing.
  const onSetPairing = useCallback((pairingId: string) => {
    const pair = PAIRING_BY_ID[pairingId];
    if (!pair) return;
    setRoll((prev) => ({
      ...prev,
      pairing: pair,
      fontSans: pair.sans,
      fontSerif: pair.serif,
    }));
  }, []);

  // Theme swap — re-runs the full roll with the new theme but keeps scene,
  // fx, pairing, and punch-wobble fixed. Per-word plans necessarily re-
  // randomize (accent slots map to different colors and the RNG must rerun)
  // but block transform + word overrides survive (they're keyed by index).
  const onSetTheme = useCallback(
    (themeId: string) => {
      setRoll(
        rollFn({
          themeId,
          sceneId: roll.scene.id,
          fxId: roll.bodyFx.id,
          emphasisFxId: roll.emphasisFx.id,
          pairingId: roll.pairing.id,
          punchWobble: roll.punchWobble,
        }),
      );
      remount();
    },
    [roll, remount],
  );

  // Body-FX swap — patches every non-emphasis (sans) body word's fx in place.
  // Emphasis (italic) words keep their own intense fx. Per-word overrides
  // (ovr.fxOverride) are untouched, so an explicitly-assigned word keeps it.
  const onSetBodyFx = useCallback(
    (fxId: WordFxId) => {
      const spec = FX_BY_ID[fxId];
      if (!spec) return;
      setRoll((prev) => ({
        ...prev,
        bodyFx: spec,
        words: prev.words.map((w) =>
          w.kind === 'body' && !w.italic ? { ...w, fx: fxId } : w,
        ),
      }));
      remount();
    },
    [remount],
  );

  // Emphasis-FX swap — patches every italic body word's fx in place.
  const onSetEmphasisFx = useCallback(
    (fxId: WordFxId) => {
      const spec = FX_BY_ID[fxId];
      if (!spec) return;
      setRoll((prev) => ({
        ...prev,
        emphasisFx: spec,
        words: prev.words.map((w) =>
          w.kind === 'body' && w.italic ? { ...w, fx: fxId } : w,
        ),
      }));
      remount();
    },
    [remount],
  );

  // User-initiated selection. Auto-pauses so the dragged target isn't also
  // moving from the keyframes. Programmatic selections (initial mount,
  // reroll) call setSelection directly — they intentionally don't pause so
  // the user can see what was just rolled.
  const onSelect = useCallback((s: Selection) => {
    setSelection(s);
    if (s !== null) setPlaying(false);
  }, []);

  // Playback — drives the data-paused attribute on LabStage; bumps mountKey
  // on completion so the same scene loops cleanly (matches the prior Lab).
  const durationMs = roll.scene.dur * 1000;
  const playback = usePlayback({
    durationMs,
    speed: 1,
    playing,
    onComplete: () => {
      remount();
      playback.reset();
    },
  });
  useEffect(() => {
    playback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountKey]);

  // Copy preset → clipboard. Same exportPreset path the previous Lab used,
  // now extended to include blockTransform + the new override fields.
  const onCopyJson = useCallback(async () => {
    const spec = exportPreset(roll, overrides, blockTransform);
    const text = JSON.stringify(spec, null, 2);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Clipboard API can reject on insecure context or denied permission;
        // fall through to the textarea fallback below.
      }
    }
    copyViaTextarea(text);
  }, [roll, overrides, blockTransform]);

  // Save the current composition to the server-side themes catalog so it
  // shows up on /themes. The lab payload goes under styleSpec.lab as an
  // opaque blob — the backend doesn't interpret it, only the lab + /themes
  // adapter do.
  const onSaveTheme = useCallback(async () => {
    const defaultName = roll.theme.name;
    const name =
      typeof window !== 'undefined'
        ? window.prompt('Name this theme:', defaultName)
        : defaultName;
    if (!name) return;
    try {
      await createTheme({
        name: name.trim(),
        description: `${roll.theme.name} · ${roll.bodyFx.label} → ${roll.emphasisFx.label} · ${roll.pairing.name}`,
        templateId: 'caption-designer',
        styleSpec: {
          lab: {
            // Persist exactly what the lab needs to re-hydrate the
            // composition. Names + scene let the /themes card preview
            // the look without re-fetching theme metadata.
            themeId: roll.theme.id,
            themeName: roll.theme.name,
            themeCategory: roll.theme.category,
            themeBg: roll.theme.bg,
            themeInk: roll.theme.ink,
            themeAccents: {
              c1: roll.theme.c1,
              c2: roll.theme.c2,
              c3: roll.theme.c3,
              c4: roll.theme.c4,
            },
            sceneId: roll.scene.id,
            sceneText: roll.scene.text,
            scenePunch: roll.scene.punch,
            sceneDur: roll.scene.dur,
            bodyFxId: roll.bodyFx.id,
            emphasisFxId: roll.emphasisFx.id,
            pairingId: roll.pairing.id,
            punchOverride,
            overrides,
            blockTransform,
          },
        },
      });
      if (typeof window !== 'undefined') {
        window.alert(`Saved "${name.trim()}" to your themes.`);
      }
    } catch (err) {
      console.error('Failed to save theme', err);
      if (typeof window !== 'undefined') {
        window.alert(
          `Couldn't save theme: ${(err as Error).message ?? 'unknown error'}`,
        );
      }
    }
  }, [roll, overrides, blockTransform, punchOverride]);

  // Drives the layer-tree row count + accent slot lookup in WordProperties.
  const wordSelection = useMemo(() => selection, [selection]);

  return (
    <div className={styles.composer}>
      <ComposerToolbar
        roll={displayRoll}
        playing={playing}
        onReroll={onReroll}
        onTogglePlay={() => setPlaying((p) => !p)}
        onCopyJson={onCopyJson}
        onSaveTheme={onSaveTheme}
      />

      <div className={styles.composerGrid}>
        <LayerTree
          roll={displayRoll}
          overrides={overrides}
          selection={wordSelection}
          onSelect={onSelect}
        />

        <ComposerCanvas
          roll={displayRoll}
          overrides={overrides}
          blockTransform={blockTransform}
          mountKey={mountKey}
          paused={!playing}
          selection={wordSelection}
          onSelect={onSelect}
          onChangeWordTransform={onChangeWordTransform}
          onChangeBlockTransform={onChangeBlockTransform}
        />

        <PropertiesPanel
          roll={displayRoll}
          overrides={overrides}
          blockTransform={blockTransform}
          selection={wordSelection}
          onSetWordOverride={onSetWordOverride}
          onClearWordOverride={onClearWordOverride}
          onChangeBlockTransform={onChangeBlockTransform}
          onResetBlockTransform={onResetBlockTransform}
          onSetPairing={onSetPairing}
          onSetTheme={onSetTheme}
          onSetBodyFx={onSetBodyFx}
          onSetEmphasisFx={onSetEmphasisFx}
          onSetPunch={onSetPunch}
        />
      </div>
    </div>
  );
}

function copyViaTextarea(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // Best-effort fallback — both paths failed, nothing more to do.
  }
  document.body.removeChild(ta);
}
