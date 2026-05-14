// Authenticated app shell. Replaces the shadcn RootLayout + AppSidebar.
//
// Renders:
//   - Sticky top-left wordmark + ••• command menu trigger.
//   - PageActionsSlot in the top-right (portal target for per-page CTAs).
//   - Page outlet underneath.
// Wraps JobsProvider so the jobs poll (shared by JobsPage + CommandMenu badge)
// keeps running across navigations.

import { Outlet, useLocation } from 'react-router-dom';
import { JobsProvider, useJobsContext } from '@/lib/jobsContext';
import { useAuth } from '@/lib/auth';
import { Wordmark } from './Wordmark';
import { CommandMenu } from './CommandMenu';
import { PageActionsSlot } from './PageActions';
import styles from './atelier.module.css';

const ROUTE_TAGLINES: Record<string, string> = {
  '/agent/new': 'CAPTION AGENT · V0.1',
  '/jobs': 'RENDER LEDGER · V0.1',
  '/themes': 'THEME GALLERY · V0.1',
  '/settings': 'ACCOUNT · V0.1',
};

function ShellInner() {
  const location = useLocation();
  const { inFlightCount } = useJobsContext();
  const { logout } = useAuth();
  const tagline =
    ROUTE_TAGLINES[location.pathname] ??
    (location.pathname.startsWith('/agent') ? 'CAPTION AGENT · V0.1' : 'ATELIER · V0.1');

  return (
    <div className={styles.shell}>
      <header className={styles.shellHeader}>
        <Wordmark tagline={tagline} />
        <CommandMenu
          inFlightCount={inFlightCount}
          onSignOut={() => {
            void logout();
          }}
        />
        <span className={styles.grow} />
        <PageActionsSlot />
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
