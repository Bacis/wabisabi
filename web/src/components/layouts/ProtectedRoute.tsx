import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

// Auth gate that wraps every authenticated route. Defers rendering while
// the auth context is still resolving the session cookie. Redirects to
// /login (preserving the attempted path so we can bounce back after sign-in).
export function ProtectedRoute() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
