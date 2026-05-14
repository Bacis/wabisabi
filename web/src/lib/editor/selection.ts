// Selection resolver. The store keeps a single `selectedId` field; this
// helper figures out whether the ID points at a clip/word/overlay or a
// caption group. Per the spec: when a caption word is selected, the gizmo
// targets the *group* — that mapping happens in SelectionLayer, not here.

import type { Selection, Track } from './types';

export function resolveSelection(
  tracks: Track[],
  selectedId: string | null,
): Selection {
  if (!selectedId) return null;
  for (const track of tracks) {
    const item = track.items.find((i) => i.id === selectedId);
    if (item) return { kind: 'item', item, track };
    if (track.type === 'captions') {
      const group = track.groups.find((g) => g.id === selectedId);
      if (group) return { kind: 'group', group, track };
    }
  }
  return null;
}

// Given a selection that's a caption word, return the group that owns it.
// Used by SelectionLayer to redirect the gizmo target.
export function groupForSelection(selection: Selection) {
  if (!selection) return null;
  if (selection.kind === 'group') return { group: selection.group, track: selection.track };
  if (selection.kind === 'item' && selection.track.type === 'captions') {
    const item = selection.item;
    if ('groupId' in item) {
      const captionTrack = selection.track;
      const group = captionTrack.groups.find((g) => g.id === item.groupId);
      if (group) return { group, track: captionTrack };
    }
  }
  return null;
}
