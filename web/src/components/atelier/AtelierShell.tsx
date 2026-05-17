// Authenticated app shell — Caption Studio · wabisabi chrome.
//
// Header layout (52px, sticky, blurred):
//   [BrandMark · Caption Studio · wabisabi]   [Create · Library · Docs]   [FREE PLAN][avatar/menu][PageActionsSlot]
//
// PageActionsSlot stays as a portal target so per-page CTAs (e.g. designer's
// preview/render buttons) can still inject into the right side.
// JobsProvider wraps the shell so the in-flight jobs poll (read by the
// avatar menu's badge) keeps running across navigations.

import { NavLink, Outlet } from 'react-router-dom';
import { JobsProvider, useJobsContext } from '@/lib/jobsContext';
import { useAuth } from '@/lib/auth';
import { Wordmark } from './Wordmark';
import { CommandMenu } from './CommandMenu';
import { PageActionsSlot } from './PageActions';
import styles from './atelier.module.css';

function ShellInner() {
  const { inFlightCount } = useJobsContext();
  const { state, logout } = useAuth();
  const email = state.status === 'authenticated' ? state.user.email : undefined;

  return (
    <div className={styles.shell}>
      <header className={styles.shellHeader}>
        <Wordmark to="/" />
        <nav className={styles.shellNav}>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              [styles.shellNavLink, isActive ? styles.active : '']
                .filter(Boolean)
                .join(' ')
            }
          >
            Create
          </NavLink>
          <NavLink
            to="/library"
            className={({ isActive }) =>
              [styles.shellNavLink, isActive ? styles.active : '']
                .filter(Boolean)
                .join(' ')
            }
          >
            Library
          </NavLink>
          <NavLink
            to="/themes"
            className={({ isActive }) =>
              [styles.shellNavLink, isActive ? styles.active : '']
                .filter(Boolean)
                .join(' ')
            }
          >
            Themes
          </NavLink>
          <NavLink
            to="/docs"
            className={({ isActive }) =>
              [styles.shellNavLink, isActive ? styles.active : '']
                .filter(Boolean)
                .join(' ')
            }
          >
            Docs
          </NavLink>
        </nav>
        <div className={styles.shellRight}>
          <span className={styles.creditsChip}>
            <span className={styles.creditsDot} />
            <b>FREE</b> plan
          </span>
          <PageActionsSlot />
          <CommandMenu
            inFlightCount={inFlightCount}
            userEmail={email}
            onSignOut={() => {
              void logout();
            }}
          />
        </div>
      </header>
      <main className={styles.shellMain}>
        <div className={styles.pageBleed}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function AtelierShell() {
  return (
    <JobsProvider>
      <ShellInner />
    </JobsProvider>
  );
}
