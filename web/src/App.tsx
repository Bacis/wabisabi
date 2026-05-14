import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './components/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AtelierShell } from './components/atelier';
import { JobsPage } from './pages/JobsPage';
import { ThemesPage } from './pages/ThemesPage';
import { NewAgentPage } from './pages/agents/NewAgentPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useAuth } from './lib/auth';

function LoginRoute() {
  const { state } = useAuth();
  if (state.status === 'authenticated') {
    return <Navigate to="/agent/new" replace />;
  }
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AtelierShell />}>
          <Route index element={<Navigate to="/agent/new" replace />} />
          <Route path="agent/new" element={<NewAgentPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="themes" element={<ThemesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
