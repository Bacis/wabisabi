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
    // The whole-video scene plan. Saved so the renderer's <CueLayer> can
    // fire the same audio cues the live preview plays back. Null when the
    // agent never called apply_director_script for this design.
    directorScript: state.directorScript,
  };
}
