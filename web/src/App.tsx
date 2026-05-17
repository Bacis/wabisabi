import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './components/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AtelierShell } from './components/atelier';
import { StartPage } from './pages/start/StartPage';
import { LibraryPage } from './pages/library/LibraryPage';
import { ThemesPage } from './pages/ThemesPage';
import { DesignerSessionPage } from './pages/designer/DesignerSessionPage';
import { DesignerHistoryPage } from './pages/designer/DesignerHistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { DocsPage } from './pages/docs/DocsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useAuth } from './lib/auth';

function LoginRoute() {
  const { state } = useAuth();
  if (state.status === 'authenticated') {
    return <Navigate to="/" replace />;
  }
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AtelierShell />}>
          <Route index element={<StartPage />} />
          {/* Submitting on the Start page renders AgentDesigner inline (URL
              stays at "/"), then redirects to /designer/:id once the first
              chat turn lands. The old /designer/new picker step is gone —
              we send anyone who lands there to the homepage. */}
          <Route path="designer/new" element={<Navigate to="/" replace />} />
          <Route path="designer/history" element={<DesignerHistoryPage />} />
          <Route path="designer/:id" element={<DesignerSessionPage />} />
          {/* Back-compat: any inbound link to the old /agent route family
              bounces to the homepage. Safe to drop in a follow-up. */}
          <Route path="agent/new" element={<Navigate to="/" replace />} />
          <Route path="agent/*" element={<Navigate to="/" replace />} />
          {/* The Render Ledger is replaced by the curated /library page. */}
          <Route path="jobs" element={<Navigate to="/library" replace />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="themes" element={<ThemesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
