import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './components/LoginPage';
import { ProtectedRoute } from './components/layouts/ProtectedRoute';
import { RootLayout } from './components/layouts/RootLayout';
import { JobsPage } from './pages/JobsPage';
import { EditorPage } from './pages/EditorPage';
import { ThemesPage } from './pages/ThemesPage';
import { NewThemePage } from './pages/themes/NewThemePage';
import { ThemeDetailPage } from './pages/themes/ThemeDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useAuth } from './lib/auth';

function LoginRoute() {
  const { state } = useAuth();
  if (state.status === 'authenticated') {
    return <Navigate to="/jobs" replace />;
  }
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<RootLayout />}>
          <Route index element={<Navigate to="/jobs" replace />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:id" element={<EditorPage />} />
          <Route path="themes" element={<ThemesPage />} />
          <Route path="themes/new" element={<NewThemePage />} />
          <Route path="themes/:id" element={<ThemeDetailPage />} />
          {/* Legacy redirect: old /presets bookmarks land in the new themes
              gallery. Remove after one release. */}
          <Route path="presets" element={<Navigate to="/themes" replace />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
