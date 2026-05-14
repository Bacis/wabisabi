import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, FileVideo, Palette, Settings, LogOut } from 'lucide-react';
import styles from './atelier.module.css';

export type CommandMenuItem = {
  to?: string;
  onSelect?: () => void;
  label: string;
  hint?: string;
  icon: ReactNode;
};

const NAV: CommandMenuItem[] = [
  { to: '/agent/new', label: 'Agent', hint: '/agent', icon: <Bot size={16} /> },
  { to: '/jobs', label: 'Jobs', hint: '/jobs', icon: <FileVideo size={16} /> },
  { to: '/themes', label: 'Themes', hint: '/themes', icon: <Palette size={16} /> },
  { to: '/settings', label: 'Account', hint: '/settings', icon: <Settings size={16} /> },
];

export function CommandMenu({
  inFlightCount = 0,
  onSignOut,
}: {
  inFlightCount?: number;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const location = useLocation();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isActive = (to?: string) =>
    !!to && (location.pathname === to || location.pathname.startsWith(to + '/'));

  return (
    <div className={styles.cmAnchor} ref={anchorRef}>
      <button
        id={triggerId}
        type="button"
        className={styles.cmTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label="Open menu"
      >
        •••
      </button>
      {open && (
        <div
          role="menu"
          aria-labelledby={triggerId}
          className={styles.cmPopover}
        >
          <span className={styles.cmHeader}>Navigate</span>
          {NAV.map((item) => {
            const active = isActive(item.to);
            const badge =
              item.to === '/jobs' && inFlightCount > 0
                ? `${inFlightCount} live`
                : item.hint;
            return (
              <Link
                key={item.label}
                to={item.to!}
                role="menuitem"
                className={[styles.cmRow, active ? styles.active : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.cmIcon}>{item.icon}</span>
                <span className={styles.cmLabel}>{item.label}</span>
                <span className={styles.cmHint}>{badge}</span>
              </Link>
            );
          })}
          <div className={styles.cmDivider} aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className={styles.cmRow}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <span className={styles.cmIcon}>
              <LogOut size={16} />
            </span>
            <span className={styles.cmLabel}>Sign out</span>
            <span className={styles.cmHint}>session</span>
          </button>
        </div>
      )}
    </div>
  );
}
