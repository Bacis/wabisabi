import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, Palette, Settings, LogOut, History, Sparkles } from 'lucide-react';
import styles from './atelier.module.css';

export type CommandMenuItem = {
  to?: string;
  onSelect?: () => void;
  label: string;
  hint?: string;
  icon: ReactNode;
};

const NAV: CommandMenuItem[] = [
  { to: '/', label: 'Designer', hint: '/', icon: <Bot size={16} /> },
  { to: '/designer/history', label: 'History', hint: '/designer/history', icon: <History size={16} /> },
  { to: '/library', label: 'Library', hint: '/library', icon: <Sparkles size={16} /> },
  { to: '/themes', label: 'Themes', hint: '/themes', icon: <Palette size={16} /> },
  { to: '/settings', label: 'Account', hint: '/settings', icon: <Settings size={16} /> },
];

function initialsFromEmail(email: string | undefined): string {
  if (!email) return '··';
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0]! + parts[1][0]!).toUpperCase();
  return (local.slice(0, 2) || '··').toUpperCase();
}

export function CommandMenu({
  inFlightCount = 0,
  onSignOut,
  userEmail,
}: {
  inFlightCount?: number;
  onSignOut: () => void;
  userEmail?: string;
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

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isActive = (to?: string) =>
    !!to &&
    (to === '/'
      ? location.pathname === '/'
      : location.pathname === to || location.pathname.startsWith(to + '/'));

  return (
    <div className={styles.cmAnchor} ref={anchorRef}>
      <button
        id={triggerId}
        type="button"
        className={styles.avatar}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label="Open menu"
      >
        {initialsFromEmail(userEmail)}
      </button>
      {open && (
        <div
          role="menu"
          aria-labelledby={triggerId}
          className={[styles.cmPopover, styles.cmPopoverRight]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.cmHeader}>
            {userEmail ?? 'Navigate'}
          </span>
          {NAV.map((item) => {
            const active = isActive(item.to);
            const badge =
              item.to === '/library' && inFlightCount > 0
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
