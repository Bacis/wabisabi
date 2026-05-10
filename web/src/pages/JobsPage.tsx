import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileVideo, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useJobsContext } from '@/lib/jobsContext';
import { useUploadJob } from '@/lib/useUploadJob';
import type { JobSummary } from '@/lib/api';
import { JobCard } from './jobs/JobCard';

type Filter = 'all' | JobSummary['status'];
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

export function JobsPage() {
  const { jobs, isLoading, refresh } = useJobsContext();
  const [filter, setFilter] = useState<Filter>('all');
  const navigate = useNavigate();

  const upload = useUploadJob({
    onUploaded: (id) => {
      // Refresh the list so the new job is in the polled cache before
      // the editor mounts, then jump straight into editing.
      refresh();
      navigate(`/jobs/${id}`);
    },
  });

  const visible = useMemo(() => {
    if (filter === 'all') return jobs;
    return jobs.filter((j) => j.status === filter);
  }, [jobs, filter]);

  // Per-status counts for the filter pills' trailing badges. Using the
  // unfiltered list so the totals don't shift when a filter is active.
  const counts = useMemo(() => {
    const out: Record<Filter, number> = {
      all: jobs.length,
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
    };
    for (const j of jobs) out[j.status]++;
    return out;
  }, [jobs]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <input {...upload.inputProps} />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Your video caption renders. Upload a clip to start a new one.
          </p>
        </div>
        <Button
          size="lg"
          onClick={upload.pickFile}
          disabled={upload.busy}
          className="gap-2"
        >
          <Upload className="size-4" />
          {upload.busy ? 'Uploading…' : 'New upload'}
        </Button>
      </header>

      {upload.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {upload.error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground',
              )}
            >
              <span>{f.label}</span>
              <Badge
                variant="secondary"
                className={cn(
                  'h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] font-medium tabular-nums',
                  active && 'bg-primary text-primary-foreground',
                )}
              >
                {counts[f.value]}
              </Badge>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        jobs.length === 0 ? (
          <EmptyState onUpload={upload.pickFile} busy={upload.busy} />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
            No {filter} jobs.
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  onUpload,
  busy,
}: {
  onUpload: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/40 p-12 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FileVideo className="size-6" />
      </div>
      <h2 className="text-base font-semibold">No jobs yet</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Upload a video to generate kinetic captions.
      </p>
      <Button onClick={onUpload} disabled={busy} className="gap-2">
        <Upload className="size-4" />
        {busy ? 'Uploading…' : 'Upload your first video'}
      </Button>
    </div>
  );
}
