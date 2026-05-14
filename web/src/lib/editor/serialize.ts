// Pull the persistable slice out of the editor store. Strips volatile UI
// fields (currentTime, playing, selectedId, etc.) so they don't pollute the
// JSON column on the designs row.

import type { EditorStore } from './store';
import type { PersistedDesignState } from './types';

export function serializeState(state: EditorStore): PersistedDesignState {
  return {
    version: 1,
    tracks: state.tracks,
    groupStyles: state.groupStyles,
    durationSec: state.durationSec,
    templateId: state.templateId,
    styleSpec: state.styleSpec,
    transcriptText: state.transcriptText,
  };
}
