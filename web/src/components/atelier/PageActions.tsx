// Header-right portal so any page (notably AgentDesigner's HeaderActions) can
// inject Save/Render buttons into the AtelierShell header without prop-drilling.

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SLOT_ID = 'atelier-page-actions';

export function PageActionsSlot() {
  return (
    <div
      id={SLOT_ID}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
    />
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setEl(document.getElementById(SLOT_ID));
  }, []);
  if (!el) return null;
  return createPortal(children, el);
}
