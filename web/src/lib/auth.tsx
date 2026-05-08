import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  UnauthenticatedError,
  type AuthUser,
} from './api';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: AuthUser };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Called from the api layer when any request returns 401, so the rest
  // of the UI can drop straight back to the login page without each
  // component having to handle the failure.
  markUnauthenticated: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((user) => {
        if (cancelled) return;
        setState(user ? { status: 'authenticated', user } : { status: 'unauthenticated' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unauthenticated' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const user = await apiLogin(email, password);
    setState({ status: 'authenticated', user });
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ status: 'unauthenticated' });
  }, []);

  const markUnauthenticated = useCallback(() => {
    setState((prev) =>
      prev.status === 'authenticated' ? { status: 'unauthenticated' } : prev,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout, markUnauthenticated }),
    [state, login, logout, markUnauthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// React-Strict-friendly hook for components: any call into the api that
// throws UnauthenticatedError should bubble up to the AuthProvider.
export function useUnauthenticatedHandler() {
  const { markUnauthenticated } = useAuth();
  return useCallback(
    (err: unknown) => {
      if (err instanceof UnauthenticatedError) markUnauthenticated();
    },
    [markUnauthenticated],
  );
}
