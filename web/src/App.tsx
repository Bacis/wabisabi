import { useCallback, useEffect, useState } from 'react';
import { JobList } from './components/JobList';
import { Editor } from './components/Editor';
import { UploadButton } from './components/UploadButton';
import { fetchJobs, type JobSummary } from './lib/api';

export function App() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const refreshJobs = useCallback(() => {
    fetchJobs()
      .then(setJobs)
      .catch((err) => console.error('jobs fetch failed', err));
  }, []);

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
      <aside className="w-72 border-r border-ink-700 bg-ink-800 overflow-y-auto">
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
