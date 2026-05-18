// Caption Designer state store. Zustand keeps it small; component-level
// useState everywhere would force prop-drilling through Timeline / Inspector
// / SelectionLayer that all touch the same fields.
//
// Volatile fields (currentTime, playing, selectedId, shiftHeld) are stripped
// before persistence by serialize.ts. designId / designName live in the
// store for convenience (TopBar uses them) but get saved alongside `state`
// as separate columns on the DB row.

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { mergeStyleSpec } from '@shared/presets';
import { setPath } from '@/lib/dotPath';
import type { Transform, GroupStyle } from '@/lib/api';
import type { DirectorScript, SceneGroup } from '@/lib/director';
import type {
  Track,
  Selection,
  PersistedDesignState,
  CaptionWordItem,
  OverlayItem,
  CaptionTrack,
} from './types';
import { resolveSelection } from './selection';
import { snapFrame, clampNonNegative, FPS } from './snap';
import { DEFAULT_GROUP_STYLE_ID } from './groupStyles';
import { newId } from './loadFromSource';
import { CANVAS_W, CANVAS_H } from './coords';

type DesignSourceRef =
  | { kind: 'stock'; clipId: string }
  | { kind: 'job'; jobId: string }
  | null;

export type EditorStore = {
  // Persisted slice
  tracks: Track[];
  groupStyles: Record<string, GroupStyle>;
  durationSec: number;
  templateId: string;                         // 'reel-clone' | 'pop-words' | 'caption-designer'
  styleSpec: Record<string, any>;             // template-driven style; mirrors old <Editor>
  transcriptText: string;                     // raw text for the bulk transcript override
  transcriptOverridden: boolean;
  // Director plan — when the agent returns an apply_director_script tool
  // call, useAgentChat populates this. The timeline groups lane (Day 16+)
  // reads it as its single source of truth; the renderer (post-Day 5) reads
  // it for per-word cascade lookup via resolveWordContext.
  directorScript: DirectorScript | null;

  // Design metadata
  designId: string | null;
  designName: string;
  source: DesignSourceRef;

  // Source canvas dimensions. Defaults to 1080×1920 (vertical reel) and
  // is overridden when a horizontal source loads (widthPx > heightPx).
  // Drives Player compositionWidth/Height, the editor's coordinate space,
  // and the preview's aspect-ratio CSS. All Transform coordinates are
  // stored in this space — designs saved at one aspect won't auto-migrate
  // to another if the source is swapped (out of scope for v1).
  canvasWidth: number;
  canvasHeight: number;

  // Volatile UI state
  currentTime: number;
  playing: boolean;
  selectedId: string | null;
  pxPerSec: number;
  snapEnabled: boolean;
  shiftHeld: boolean;
  // Word the user has scoped the agent's next message to (point-and-prompt).
  // Volatile: stripped before persistence in serialize.ts. Cleared whenever
  // the transcript text mutates (idx becomes meaningless across edits).
  selectedWord: { idx: number; text: string; t: number; d: number } | null;
  // Same idea for scene groups — the timeline group lane sets this when a
  // pill is clicked so the next agent turn can scope to that group.
  selectedDirectorGroupId: string | null;
  // Cross-component prefill: WordStyler's "ask agent" button writes here,
  // AgentChatPane reads + clears. Volatile (not persisted).
  chatPrefill: string | null;

  // Initialization
  loadDesign(input: {
    persisted: PersistedDesignState;
    source: DesignSourceRef;
    designId: string | null;
    designName: string;
    templateId: string;
    styleSpec: Record<string, any>;
    transcriptText: string;
    // Source's intrinsic pixel dimensions. When omitted, the canvas
    // stays at its current dims (defaults to 1080×1920). Pass these
    // when loading a job/upload that has widthPx/heightPx metadata so
    // the editor opens in the matching aspect.
    canvasWidth?: number;
    canvasHeight?: number;
  }): void;
  setCanvasDims(w: number, h: number): void;

  // Template / styleSpec / transcript edits
  setTemplateId(id: string): void;
  setStyleSpec(spec: Record<string, any>): void;
  updateStyleSpecPath(path: string, value: unknown): void;
  applyThemePatch(patch: Record<string, any>): void;
  // Director plan edits
  setDirectorScript(script: DirectorScript | null): void;
  updateDirectorGroup(id: string, partial: Partial<SceneGroup>): void;
  setTranscriptText(text: string): void;
  rebuildCaptionsFromTranscript(): void;
  // styleSpec.captionTransform — the single positionable caption box that
  // applies in templates without their own per-group transforms (reel-
  // clone, pop-words). Editor renders a hit-zone bound to this field; the
  // template reads it from styleSpec to position its caption container.
  setCaptionTransform(t: Transform): void;

  // Playback
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(t: number): void;
  setCurrentTime(t: number): void;

  // Selection
  select(id: string | null): void;
  selectWordForAgent(
    w: { idx: number; text: string; t: number; d: number } | null,
  ): void;
  clearSelectedWord(): void;
  selectGroupForAgent(groupId: string | null): void;
  setChatPrefill(text: string | null): void;

  // Timeline
  setPxPerSec(n: number): void;
  zoomIn(): void;
  zoomOut(): void;
  setSnapEnabled(b: boolean): void;
  setShiftHeld(b: boolean): void;

  // Item edits
  moveItem(itemId: string, newTrackId: string, newStart: number): void;
  resizeItem(itemId: string, newStart: number, newDuration: number): void;
  updateOverlayTransform(id: string, transform: Transform): void;
  updateOverlayLabel(id: string, label: string): void;
  addOverlay(): void;

  // Caption / group edits
  updateGroupTransform(id: string, transform: Transform): void;
  updateGroupStyle(groupId: string, styleId: string): void;
  updateGroupName(id: string, name: string): void;
  updateCaptionText(wordId: string, text: string): void;
  addGroup(): void;

  // Misc
  deleteSelected(): void;
  setDesignName(name: string): void;
  setDesignId(id: string): void;

  // Selectors
  getSelection(): Selection;
};

const MIN_PX_PER_SEC = 30;
const MAX_PX_PER_SEC = 500;

export const useEditor = create<EditorStore>()(
  devtools(
    (set, get) => ({
      tracks: [],
      groupStyles: {},
      durationSec: 0,
      templateId: 'reel-clone',
      styleSpec: {},
      transcriptText: '',
      transcriptOverridden: false,
      directorScript: null,

      designId: null,
      designName: 'Untitled design',
      source: null,

      // Default to the legacy vertical canvas; loadDesign overrides when
      // the source's intrinsic dims are known.
      canvasWidth: CANVAS_W,
      canvasHeight: CANVAS_H,

      currentTime: 0,
      playing: false,
      selectedId: null,
      pxPerSec: 100,
      snapEnabled: true,
      shiftHeld: false,
      selectedWord: null,
      selectedDirectorGroupId: null,
      chatPrefill: null,

      loadDesign({
        persisted,
        source,
        designId,
        designName,
        templateId,
        styleSpec,
        transcriptText,
        canvasWidth,
        canvasHeight,
      }) {
        // Resolve canvas dims with fallback so callers that don't pass
        // dims (legacy designs, stock clips without metadata) keep the
        // historical 1080×1920 behavior. When the caller supplies just
        // one of (w, h) treat it as both missing — partial dims are
        // ambiguous (no defensible aspect to assume).
        const w =
          canvasWidth && canvasHeight && canvasWidth > 0 && canvasHeight > 0
            ? canvasWidth
            : CANVAS_W;
        const h =
          canvasWidth && canvasHeight && canvasWidth > 0 && canvasHeight > 0
            ? canvasHeight
            : CANVAS_H;
        set({
          tracks: persisted.tracks,
          groupStyles: persisted.groupStyles,
          durationSec: persisted.durationSec,
          templateId,
          styleSpec,
          transcriptText,
          transcriptOverridden: false,
          // Director plan is per-design state. Clear on load — a freshly-loaded
          // design has no plan until the agent emits one. Day 16's timeline
          // lane treats `null` as "no plan visible, just the word lane".
          directorScript: null,
          source,
          designId,
          designName,
          canvasWidth: w,
          canvasHeight: h,
          currentTime: 0,
          playing: false,
          selectedId: null,
          selectedWord: null,
          selectedDirectorGroupId: null,
        });
      },
      setCanvasDims(w, h) {
        if (!(w > 0 && h > 0)) return;
        set({ canvasWidth: Math.round(w), canvasHeight: Math.round(h) });
      },

      setTemplateId(id) { set({ templateId: id }); },
      setStyleSpec(spec) { set({ styleSpec: spec }); },
      setDirectorScript(script) { set({ directorScript: script }); },
      updateDirectorGroup(id, partial) {
        set((state) => {
          if (!state.directorScript) return {};
          const groups = state.directorScript.groups.map((g) =>
            g.id === id ? { ...g, ...partial } : g,
          );
          return { directorScript: { ...state.directorScript, groups } };
        });
      },
      updateStyleSpecPath(path, value) {
        set((state) => ({ styleSpec: setPath(state.styleSpec, path, value) }));
      },
      applyThemePatch(patch) {
        set((state) => {
          const merged = mergeStyleSpec(state.styleSpec as any, patch) as Record<string, unknown>;
          // If the patch touches caption positioning, drop any prior
          // manual captionTransform so the new layout actually wins.
          // Renderer short-circuits to captionTransform when set, so
          // without this a drag would silently override every later
          // "center it" / "move to top" the agent issues.
          const layoutPatch = (patch as Record<string, any>).layout as
            | Record<string, unknown>
            | undefined;
          if (
            layoutPatch &&
            ('position' in layoutPatch ||
              'safeMargin' in layoutPatch ||
              'align' in layoutPatch)
          ) {
            delete merged.captionTransform;
          }
          return { styleSpec: merged };
        });
      },
      setCaptionTransform(t) {
        set((state) => ({ styleSpec: setPath(state.styleSpec, 'captionTransform', t) }));
      },
      setTranscriptText(text) {
        // Word indices in selectedWord are tied to the current transcript;
        // any retype invalidates them. Clear to avoid the agent referring to
        // a stale word.
        set({ transcriptText: text, transcriptOverridden: true, selectedWord: null });
      },
      rebuildCaptionsFromTranscript() {
        // Rebuild the caption track's word items by spreading transcriptText
        // uniformly across the source duration. Keeps existing groups intact
        // by assigning every new word to the first group (the user can
        // re-bucket from the inspector). No-op if no captions track.
        set((state) => {
          const idx = state.tracks.findIndex((t) => t.type === 'captions');
          if (idx === -1) return state;
          const captionTrack = state.tracks[idx] as CaptionTrack;
          const firstGroupId = captionTrack.groups[0]?.id;
          if (!firstGroupId) return state;
          const words = state.transcriptText
            .split(/\s+/)
            .map((w) => w.trim())
            .filter(Boolean);
          if (words.length === 0) return state;
          const dur = state.durationSec || 1;
          const per = dur / words.length;
          const newItems: CaptionWordItem[] = words.map((text, i) => ({
            id: newId('word'),
            text,
            start: snapFrame(i * per),
            duration: snapFrame(per),
            groupId: firstGroupId,
          }));
          const updated: CaptionTrack = { ...captionTrack, items: newItems };
          return {
            tracks: state.tracks.map((t, i2) => (i2 === idx ? updated : t)),
            transcriptOverridden: false,
          };
        });
      },

      play() { set({ playing: true }); },
      pause() { set({ playing: false }); },
      togglePlay() { set({ playing: !get().playing }); },
      seek(t) {
        const clamped = Math.max(0, Math.min(t, get().durationSec));
        set({ currentTime: snapFrame(clamped) });
      },
      setCurrentTime(t) {
        // Driven by <Player> timeupdate — don't snap, the Player reports
        // sub-frame times and we want smooth playhead motion.
        set({ currentTime: Math.max(0, Math.min(t, get().durationSec)) });
      },

      select(id) { set({ selectedId: id }); },
      selectWordForAgent(w) { set({ selectedWord: w }); },
      clearSelectedWord() { set({ selectedWord: null }); },
      selectGroupForAgent(groupId) { set({ selectedDirectorGroupId: groupId }); },
      setChatPrefill(text) { set({ chatPrefill: text }); },

      setPxPerSec(n) {
        set({ pxPerSec: Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, n)) });
      },
      zoomIn() { get().setPxPerSec(get().pxPerSec * 1.25); },
      zoomOut() { get().setPxPerSec(get().pxPerSec / 1.25); },
      setSnapEnabled(b) { set({ snapEnabled: b }); },
      setShiftHeld(b) { set({ shiftHeld: b }); },

      moveItem(itemId, newTrackId, newStart) {
        const snapped = snapFrame(clampNonNegative(newStart));
        set((state) => {
          // Find source track + item
          let source: Track | null = null;
          let item: Track['items'][number] | null = null;
          for (const t of state.tracks) {
            const found = t.items.find((i) => i.id === itemId);
            if (found) { source = t; item = found; break; }
          }
          if (!source || !item) return state;

          const target = state.tracks.find((t) => t.id === newTrackId);
          if (!target) return state;
          // Only allow cross-track moves between compatible types.
          if (target.type !== source.type) return state;

          if (source.id === target.id) {
            return {
              tracks: state.tracks.map((t) =>
                t.id === source!.id
                  ? ({
                      ...t,
                      items: t.items.map((i) =>
                        i.id === itemId ? ({ ...i, start: snapped } as typeof i) : i,
                      ),
                    } as Track)
                  : t,
              ),
            };
          }
          // Cross-track move.
          return {
            tracks: state.tracks.map((t) => {
              if (t.id === source!.id) {
                return { ...t, items: t.items.filter((i) => i.id !== itemId) } as Track;
              }
              if (t.id === target.id) {
                return {
                  ...t,
                  items: [...t.items, { ...item!, start: snapped } as typeof item],
                } as Track;
              }
              return t;
            }),
          };
        });
      },

      resizeItem(itemId, newStart, newDuration) {
        const start = snapFrame(clampNonNegative(newStart));
        const duration = snapFrame(Math.max(1 / FPS, newDuration));
        set((state) => ({
          tracks: state.tracks.map((t) => ({
            ...t,
            items: t.items.map((i) =>
              i.id === itemId ? ({ ...i, start, duration } as typeof i) : i,
            ),
          })) as Track[],
        }));
      },

      updateOverlayTransform(id, transform) {
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'overlay'
              ? {
                  ...t,
                  items: t.items.map((it) =>
                    it.id === id ? ({ ...it, transform } as OverlayItem) : it,
                  ),
                }
              : t,
          ),
        }));
      },

      updateOverlayLabel(id, label) {
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'overlay'
              ? {
                  ...t,
                  items: t.items.map((it) =>
                    it.id === id ? ({ ...it, label } as OverlayItem) : it,
                  ),
                }
              : t,
          ),
        }));
      },

      addOverlay() {
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'overlay'
              ? {
                  ...t,
                  items: [
                    ...t.items,
                    {
                      id: newId('ov'),
                      start: snapFrame(state.currentTime),
                      duration: 2,
                      label: 'Text',
                      transform: {
                        x: CANVAS_W * 0.25,
                        y: CANVAS_H * 0.3,
                        w: CANVAS_W * 0.5,
                        h: 160,
                        rot: 0,
                      },
                    },
                  ],
                }
              : t,
          ),
        }));
      },

      updateGroupTransform(id, transform) {
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'captions'
              ? {
                  ...t,
                  groups: t.groups.map((g) =>
                    g.id === id ? { ...g, transform } : g,
                  ),
                }
              : t,
          ),
        }));
      },

      updateGroupStyle(groupId, styleId) {
        if (!get().groupStyles[styleId]) return;
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'captions'
              ? {
                  ...t,
                  groups: t.groups.map((g) =>
                    g.id === groupId ? { ...g, styleId } : g,
                  ),
                }
              : t,
          ),
        }));
      },

      updateGroupName(id, name) {
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'captions'
              ? {
                  ...t,
                  groups: t.groups.map((g) =>
                    g.id === id ? { ...g, name } : g,
                  ),
                }
              : t,
          ),
        }));
      },

      updateCaptionText(wordId, text) {
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'captions'
              ? {
                  ...t,
                  items: t.items.map((i) =>
                    i.id === wordId ? ({ ...i, text } as CaptionWordItem) : i,
                  ),
                }
              : t,
          ),
        }));
      },

      addGroup() {
        const id = newId('group');
        set((state) => ({
          tracks: state.tracks.map((t) =>
            t.type === 'captions'
              ? {
                  ...t,
                  groups: [
                    ...t.groups,
                    {
                      id,
                      name: `Group ${t.groups.length + 1}`,
                      styleId: DEFAULT_GROUP_STYLE_ID,
                      transform: {
                        x: CANVAS_W * 0.1,
                        y: CANVAS_H * 0.25,
                        w: CANVAS_W * 0.8,
                        h: CANVAS_H * 0.18,
                        rot: 0,
                      },
                    },
                  ],
                }
              : t,
          ),
          selectedId: id,
        }));
      },

      deleteSelected() {
        const id = get().selectedId;
        if (!id) return;
        set((state) => ({
          tracks: state.tracks.map((t) => {
            if (t.type === 'captions') {
              // If a group is being deleted, also remove its words.
              const isGroupHere = t.groups.some((g) => g.id === id);
              if (isGroupHere) {
                return {
                  ...t,
                  groups: t.groups.filter((g) => g.id !== id),
                  items: t.items.filter((i) => i.groupId !== id),
                };
              }
            }
            return { ...t, items: t.items.filter((i) => i.id !== id) } as Track;
          }),
          selectedId: null,
        }));
      },

      setDesignName(name) { set({ designName: name }); },
      setDesignId(id) { set({ designId: id }); },

      getSelection() {
        return resolveSelection(get().tracks, get().selectedId);
      },
    }),
    { name: 'caption-designer' },
  ),
);
