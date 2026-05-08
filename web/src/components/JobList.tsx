import type { JobSummary } from '../lib/api';

const STATUS_COLOR: Record<JobSummary['status'], string> = {
  queued: 'text-ink-400',
  running: 'text-amber-300',
  done: 'text-emerald-300',
  failed: 'text-rose-300',
};

type Props = {
  jobs: JobSummary[];
  activeJobId: string | null;
  onPick: (id: string) => void;
};

export function JobList({ jobs, activeJobId, onPick }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-ink-400">
        No jobs yet. Submit one via <code className="font-mono">POST /jobs</code>.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-ink-700">
      {jobs.map((job) => {
        const active = job.id === activeJobId;
        const editable = job.status === 'running' || job.status === 'done';
        return (
          <li key={job.id}>
            <button
              type="button"
              onClick={() => onPick(job.id)}
              disabled={!editable && job.status !== 'failed'}
              className={`w-full text-left px-4 py-2.5 hover:bg-ink-700 transition-colors ${
                active ? 'bg-ink-700' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-100 truncate">
                  {job.templateId}
                </span>
                <span className={`text-[11px] font-mono ${STATUS_COLOR[job.status]}`}>
                  {job.status}
                  {job.stage && job.status === 'running' ? `·${job.stage}` : ''}
                </span>
              </div>
              <div className="text-[11px] text-ink-400 font-mono truncate">
                {job.id.slice(0, 8)} · {job.createdAt.split(' ').slice(-1)[0] ?? job.createdAt}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
