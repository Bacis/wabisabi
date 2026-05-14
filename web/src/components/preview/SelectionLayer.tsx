// Overlay over the Player that captures selection + gizmo interactions.
//
// Renders one transparent-but-outlined hit-zone per caption group and per
// overlay. Clicking a hit-zone selects that element; the selected one gets
// a react-moveable gizmo attached for drag/resize/rotate.
//
// The Remotion <Player> draws the actual caption pixels — this layer only
// handles editor interactions. Caption groups are rendered even when no
// word in them is currently active, so the user always sees where each
// group lives on screen.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import type { Transform } from '@/lib/api';
import { useEditor } from '@/lib/editor/store';
import { canvasToScreenRect, scaleFromRect, screenDeltaToCanvas, CANVAS_W, CANVAS_H, type StageRect } from '@/lib/editor/coords';
import type { Track } from '@/lib/editor/types';

type HitZone =
  | { kind: 'group'; id: string; transform: Transform; label: string; color: string }
  | { kind: 'overlay'; id: string; transform: Transform; label: string }
  | { kind: 'caption-block'; id: string; transform: Transform; label: string; color: string };

const CAPTION_BLOCK_ID = '__caption_block__';

// Sensible default position for a caption block when the user hasn't set
// one. Roughly the bottom third, centered horizontally.
export const DEFAULT_CAPTION_TRANSFORM: Transform = {
  x: Math.round(CANVAS_W * 0.1),
  y: Math.round(CANVAS_H * 0.62),
  w: Math.round(CANVAS_W * 0.8),
  h: Math.round(CANVAS_H * 0.18),
  rot: 0,
};

function buildHitZones(
  tracks: Track[],
  groupStyles: ReturnType<typeof useEditor.getState>['groupStyles'],
  currentTime: number,
  templateId: string,
  styleSpec: Record<string, any>,
  defaultBlock: Transform | null,
): HitZone[] {
  const out: HitZone[] = [];

  if (templateId === 'caption-designer') {
    // Per-group + per-overlay positioning.
    for (const track of tracks) {
      if (track.type === 'captions') {
        for (const g of track.groups) {
          const style = groupStyles[g.styleId];
          out.push({
            kind: 'group',
            id: g.id,
            transform: g.transform,
            label: g.name,
            color: style?.color ?? '#a5b4fc',
          });
        }
      }
      if (track.type === 'overlay') {
        for (const item of track.items) {
          const visible = currentTime >= item.start && currentTime < item.start + item.duration;
          if (!visible) continue;
          out.push({
            kind: 'overlay',
            id: item.id,
            transform: item.transform,
            label: item.label,
          });
        }
      }
    }
    return out;
  }

  // Templates without per-group transforms (reel-clone, pop-words): one
  // hit-zone bound to styleSpec.captionTransform. When the user hasn't set
  // a transform yet, the caller supplies a measured fallback from the
  // rendered caption container's DOM bbox so the gizmo overlays the real
  // text instead of a generic bottom-third box.
  const t: Transform = styleSpec?.captionTransform ?? defaultBlock ?? DEFAULT_CAPTION_TRANSFORM;
  out.push({
    kind: 'caption-block',
    id: CAPTION_BLOCK_ID,
    transform: t,
    label: 'Captions',
    color: '#fde047',
  });
  return out;
}

export function SelectionLayer({ rect }: { rect: StageRect }) {
  const tracks = useEditor((s) => s.tracks);
  const groupStyles = useEditor((s) => s.groupStyles);
  const selectedId = useEditor((s) => s.selectedId);
  const currentTime = useEditor((s) => s.currentTime);
  const templateId = useEditor((s) => s.templateId);
  const styleSpec = useEditor((s) => s.styleSpec);
  const select = useEditor((s) => s.select);
  const updateGroupTransform = useEditor((s) => s.updateGroupTransform);
  const updateOverlayTransform = useEditor((s) => s.updateOverlayTransform);
  const setCaptionTransform = useEditor((s) => s.setCaptionTransform);
  const shiftHeld = useEditor((s) => s.shiftHeld);

  // Measured bbox of the rendered caption container (templates that mark
  // their wrapper with `data-caption-container`). Used as the gizmo's
  // default when the user hasn't yet written styleSpec.captionTransform —
  // so the selection box overlays the real text from the very first click,
  // not a generic bottom-third placeholder.
  //
  // We keep the last measurement around so the gizmo stays put between
  // active chunks (when the renderer early-returns and the container
  // briefly disappears from the DOM).
  const rootRef = useRef<HTMLDivElement>(null);
  const [measuredBlock, setMeasuredBlock] = useState<Transform | null>(null);
  useLayoutEffect(() => {
    if (templateId === 'caption-designer') return;
    const root = rootRef.current;
    if (!root) return;
    const stage = root.parentElement;
    if (!stage) return;
    const el = stage.querySelector('[data-caption-container]') as HTMLElement | null;
    if (!el) return;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    const { sx, sy } = scaleFromRect(rect);
    const next: Transform = {
      x: (b.left - rect.left) / sx,
      y: (b.top - rect.top) / sy,
      w: b.width / sx,
      h: b.height / sy,
      rot: 0,
    };
    // Bail when the bbox hasn't moved — currentTime ticks 30×/sec and we
    // don't want a re-render every frame just because the effect ran.
    setMeasuredBlock((prev) =>
      prev &&
      prev.x === next.x &&
      prev.y === next.y &&
      prev.w === next.w &&
      prev.h === next.h
        ? prev
        : next,
    );
  }, [currentTime, styleSpec, rect, templateId, tracks]);

  const zones = buildHitZones(
    tracks,
    groupStyles,
    currentTime,
    templateId,
    styleSpec,
    measuredBlock,
  );

  // refs by zone id so Moveable can target the selected one's DOM node.
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  // Force Moveable to re-attach when the selection identity changes.
  const [tick, setTick] = useState(0);
  useEffect(() => { setTick((t) => t + 1); }, [selectedId]);

  // Resolve which zone is currently selected. A word selection (kind:'item'
  // in a captions track) redirects to its parent group.
  let selectedZoneId: string | null = null;
  if (selectedId) {
    const directHit = zones.find((z) => z.id === selectedId);
    if (directHit) {
      selectedZoneId = directHit.id;
    } else {
      // Maybe the selection is a word — find its parent group.
      for (const t of tracks) {
        if (t.type !== 'captions') continue;
        const word = t.items.find((w) => w.id === selectedId);
        if (word) {
          const group = t.groups.find((g) => g.id === word.groupId);
          if (group) selectedZoneId = group.id;
          break;
        }
      }
    }
  }

  const [dragStart, setDragStart] = useState<Transform | null>(null);
  const selectedZone = selectedZoneId ? zones.find((z) => z.id === selectedZoneId) ?? null : null;

  function commit(t: Transform) {
    if (!selectedZone) return;
    if (selectedZone.kind === 'group') updateGroupTransform(selectedZone.id, t);
    else if (selectedZone.kind === 'overlay') updateOverlayTransform(selectedZone.id, t);
    else if (selectedZone.kind === 'caption-block') setCaptionTransform(t);
  }

  // Backdrop catches any click that lands outside a hit-zone or Moveable
  // handle and clears the selection. Player has clickToPlay=false so
  // intercepting bg clicks is safe; if anything inside Moveable or the
  // hit-zones is clicked, the event target won't match this div and the
  // handler stays out of the way.

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{ pointerEvents: 'none', zIndex: 30 }}
    >
      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          select(null);
        }}
      />
      {zones.map((zone) => {
        const screen = canvasToScreenRect(rect, zone.transform);
        const isSelected = zone.id === selectedZoneId;
        const color = zone.kind === 'group' ? zone.color : '#f97316';
        return (
          <div
            key={zone.id}
            ref={(el) => { refs.current[zone.id] = el; }}
            onMouseDown={(e) => {
              e.stopPropagation();
              // preventDefault stops the native browser text-selection
              // that would otherwise start on mousedown over the
              // Remotion-rendered captions beneath this hit-zone.
              e.preventDefault();
              select(zone.id);
            }}
            style={{
              position: 'absolute',
              left: screen.left,
              top: screen.top,
              width: screen.width,
              height: screen.height,
              transform: `rotate(${screen.rotate}deg)`,
              transformOrigin: 'center',
              boxSizing: 'border-box',
              border: isSelected ? `2px solid ${color}` : 'none',
              background: isSelected ? `${color}11` : 'transparent',
              cursor: 'move',
              pointerEvents: 'auto',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
            title={zone.label}
          />
        );
      })}
      {selectedZone && refs.current[selectedZone.id] && (
        <Moveable
          key={tick}
          target={refs.current[selectedZone.id]!}
          draggable
          resizable
          rotatable
          keepRatio={shiftHeld}
          throttleRotate={shiftHeld ? 15 : 0}
          origin={false}
          renderDirections={['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']}
          onDragStart={() => setDragStart(selectedZone.transform)}
          onDrag={({ beforeTranslate }) => {
            if (!dragStart) return;
            const { dx, dy } = screenDeltaToCanvas(rect, beforeTranslate[0], beforeTranslate[1]);
            commit({ ...dragStart, x: dragStart.x + dx, y: dragStart.y + dy });
          }}
          onResizeStart={() => setDragStart(selectedZone.transform)}
          onResize={({ width, height, drag }) => {
            if (!dragStart) return;
            const sx = rect.width / 1080;
            const sy = rect.height / 1920;
            commit({
              ...dragStart,
              x: dragStart.x + drag.beforeTranslate[0] / sx,
              y: dragStart.y + drag.beforeTranslate[1] / sy,
              w: width / sx,
              h: height / sy,
            });
          }}
          onRotateStart={() => setDragStart(selectedZone.transform)}
          onRotate={({ rotate }) => {
            if (!dragStart) return;
            commit({ ...dragStart, rot: rotate });
          }}
        />
      )}
    </div>
  );
}
