// Single keydown listener bound to window. Typing in inputs is exempt
// (Space must not toggle playback when editing a name).

import { useEffect } from 'react';
import { useEditor } from '@/lib/editor/store';

function inEditableField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function useKeyboard() {
  const togglePlay = useEditor((s) => s.togglePlay);
  const seek = useEditor((s) => s.seek);
  const select = useEditor((s) => s.select);
  const clearSelectedWord = useEditor((s) => s.clearSelectedWord);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const zoomIn = useEditor((s) => s.zoomIn);
  const zoomOut = useEditor((s) => s.zoomOut);
  const setSnapEnabled = useEditor((s) => s.setSnapEnabled);
  const setShiftHeld = useEditor((s) => s.setShiftHeld);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (inEditableField(e.target)) {
        if (e.key === 'Shift') setShiftHeld(true);
        return;
      }
      const s = useEditor.getState();
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(s.currentTime - 1 / 30);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(s.currentTime + 1 / 30);
      } else if (e.key === 'Home') {
        seek(0);
      } else if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        zoomOut();
      } else if (e.key.toLowerCase() === 's') {
        setSnapEnabled(!s.snapEnabled);
      } else if (e.key === 'Escape') {
        select(null);
        clearSelectedWord();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedId) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === 'Shift') {
        setShiftHeld(true);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Shift') setShiftHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [togglePlay, seek, select, clearSelectedWord, deleteSelected, zoomIn, zoomOut, setSnapEnabled, setShiftHeld]);
}
