import { createContext, useContext, type ReactNode } from 'react';
import { useJobs, type JobsState } from './useJobs';

// Context wrapper around useJobs so RootLayout owns the single polling
// interval and all descendants (sidebar badge, JobsPage grid) read the
// same up-to-date list without re-fetching.
const JobsContext = createContext<JobsState | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const value = useJobs();
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobsContext(): JobsState {
  const ctx = useContext(JobsContext);
  if (!ctx) {
    throw new Error('useJobsContext must be used inside <JobsProvider>');
  }
  return ctx;
}
