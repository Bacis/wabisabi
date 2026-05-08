import { useCallback, useEffect, useState } from 'react';
import { JobList } from './components/JobList';
import { Editor } from './components/Editor';
import { UploadButton } from './components/UploadButton';
import { LoginPage } from './components/LoginPage';
import { fetchJobs, UnauthenticatedError, type JobSummary } from './lib/api';
import { useAuth } from './lib/auth';

export function App() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900 text-ink-400 text-sm">
        Loading…
      </div>
    );
  }
  if (state.status === 'unauthenticated') {
    return <LoginPage />;
  }
  return <Dashboard />;
}

function Dashboard() {
  const { state, logout, markUnauthenticated } = useAuth();
  const userEmail = state.status === 'authenticated' ? state.user.email : '';
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const refreshJobs = useCallback(() => {
    fetchJobs()
      .then(setJobs)
      .catch((err) => {
        if (err instanceof UnauthenticatedError) {
          markUnauthenticated();
        } else {
          console.error('jobs fetch failed', err);
        }
      });
  }, [markUnauthenticated]);

  useEffect(() => {
    refreshJobs();
    // Light polling so freshly-submitted jobs appear in the list without a
    // manual refresh; also picks up status/stage transitions on existing jobs.
    const id = setInterval(refreshJobs, 5000);
    return () => clearInterval(id);
  }, [refreshJobs]);

  const handleUploaded = useCallback(
    (jobId: string) => {
      refreshJobs();
      setActiveJobId(jobId);
    },
    [refreshJobs],
  );

  return (
    <div className="flex h-screen">
      <aside className="w-72 border-r border-ink-700 bg-ink-800 overflow-y-auto flex flex-col">
        <header className="px-4 py-3 border-b border-ink-700">
          <h1 className="text-sm font-semibold tracking-wide uppercase text-ink-300">
            Caption Studio
          </h1>
        </header>
        <UploadButton onUploaded={handleUploaded} />
        <JobList
          jobs={jobs}
          activeJobId={activeJobId}
          onPick={setActiveJobId}
        />
        <footer className="mt-auto border-t border-ink-700 px-4 py-3 flex items-center justify-between gap-2 text-[11px] text-ink-400">
          <span className="truncate" title={userEmail}>{userEmail}</span>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="text-ink-300 hover:text-ink-100 underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        </footer>
      </aside>
      <main className="flex-1 overflow-hidden">
        {activeJobId ? (
          <Editor jobId={activeJobId} />
        ) : (
          <div className="h-full flex items-center justify-center text-ink-400 text-sm">
            Upload a video or pick a job from the left to start editing.
          </div>
        )}
      </main>
    </div>
  );
}
