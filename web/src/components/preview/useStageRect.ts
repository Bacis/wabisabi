// ResizeObserver on the Player container. SelectionLayer reads the
// container's bounding rect to convert canvas-space transforms back to
// screen pixels — and we need it to recompute on any resize so the gizmo
// stays aligned with the rendered captions.

import { useEffect, useState, type RefObject } from 'react';
import type { StageRect } from '@/lib/editor/coords';

export function useStageRect(ref: RefObject<HTMLElement>): StageRect | null {
  const [rect, setRect] = useState<StageRect | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      setRect({ width: b.width, height: b.height, left: b.left, top: b.top });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  return rect;
}
