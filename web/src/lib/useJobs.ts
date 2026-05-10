import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJobs, UnauthenticatedError, type JobSummary } from './api';
import { useAuth } from './auth';

export type JobsState = {
  jobs: JobSummary[];
  isLoading: boolean;
  refresh: () => void;
  inFlightCount: number;
};

// Polled jobs list. Mounted by RootLayout once so the sidebar's
// in-flight badge and JobsPage share a single fetch + interval. Other
// pages (editor / settings) still get the latest list when they read
// this hook because the layout owns the polling.
export function useJobs(intervalMs = 5000): JobsState {
  const { markUnauthenticated } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Mount-stable ref so the polling effect doesn't restart when the
  // component re-renders for unrelated reasons.
  const cancelledRef = useRef(false);

  const refresh = useCallback(() => {
    fetchJobs()
      .then((next) => {
        if (!cancelledRef.current) {
          setJobs(next);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        if (err instanceof UnauthenticatedError) {
          markUnauthenticated();
          return;
        }
        console.error('jobs fetch failed', err);
        setIsLoading(false);
      });
  }, [markUnauthenticated]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  const inFlightCount = jobs.reduce(
    (acc, j) => acc + (j.status === 'queued' || j.status === 'running' ? 1 : 0),
    0,
  );

  return { jobs, isLoading, refresh, inFlightCount };
}
