// Read-only render history. Job creation happens in /agent/new → Render;
// this page lists outcomes and links to completed render output downloads.

import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import {
  Button,
  EmptyState,
  MonoLabel,
  PageHeader,
  PillToggle,
  SerifDisplay,
  atelierStyles as a,
} from '@/components/atelier';
import { useJobsContext } from '@/lib/jobsContext';
import type { JobSummary } from '@/lib/api';
import { JobCard } from './jobs/JobCard';
import styles from './JobsPage.module.css';

type Filter = 'all' | JobSummary['status'];

export function JobsPage() {
  const { jobs, isLoading } = useJobsContext();
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    if (filter === 'all') return jobs;
    return jobs.filter((j) => j.status === filter);
  }, [jobs, filter]);

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
    <div className={`${a.page} ${a.wide}`}>
      <PageHeader
        eyebrow={
          <MonoLabel tone="amber" dot>
            Render Ledger · {jobs.length}
          </MonoLabel>
        }
        title={<SerifDisplay size="xl">Every render, accounted for.</SerifDisplay>}
        description="Past and in-flight caption renders. Outputs live for 24 hours after completion — pull the file before the sweep, or re-render."
        rightSlot={
          <Button
            as="a"
            href="/agent/new"
            variant="cyan"
            size="md"
            leadingIcon={<Bot size={13} />}
          >
            New session
          </Button>
        }
      />

      <div className={styles.toolbar}>
        <PillToggle<Filter>
          ariaLabel="Filter jobs"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'running', label: 'Live', count: counts.running, dot: true },
            { value: 'queued', label: 'Queued', count: counts.queued },
            { value: 'done', label: 'Done', count: counts.done },
            { value: 'failed', label: 'Failed', count: counts.failed },
          ]}
        />
      </div>

      {isLoading ? (
        <div className={`${a.grid} ${a.jobs}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        jobs.length === 0 ? (
          <EmptyState
            title={<em>No renders yet.</em>}
            body="Start a session and queue a render to populate this ledger."
            action={
              <Button
                as="a"
                href="/agent/new"
                variant="cyan"
                leadingIcon={<Bot size={13} />}
              >
                Open agent
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={<em>Nothing matches that filter.</em>}
            body={`No ${filter} renders right now. Try All or queue a new one.`}
            action={
              <Button onClick={() => setFilter('all')}>Show all</Button>
            }
          />
        )
      ) : (
        <div className={`${a.grid} ${a.jobs}`}>
          {visible.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
