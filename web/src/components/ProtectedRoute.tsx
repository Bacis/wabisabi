import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

// Auth gate around every authenticated route. Defers rendering while the
// auth context resolves the session cookie, then either renders the outlet
// or bounces to /login (preserving the attempted path).
export function ProtectedRoute() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--ag-ink-3)',
          fontFamily: 'var(--ag-font-mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          background: 'var(--ag-bg)',
        }}
      >
        Resolving session…
      </div>
    );
  }
  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
