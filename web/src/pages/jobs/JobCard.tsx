import { Download, Loader2, AlertCircle } from 'lucide-react';
import {
  Card,
  Chip,
  MonoLabel,
  Pill,
  SerifDisplay,
} from '@/components/atelier';
import type { JobSummary } from '@/lib/api';
import styles from './JobCard.module.css';

const TEMPLATE_LABEL: Record<string, string> = {
  'reel-clone': 'Cinematic',
  'pop-words': 'Pop Words',
  'caption-designer': 'Caption Designer',
};

const STATUS_TONE: Record<
  JobSummary['status'],
  React.ComponentProps<typeof Pill>['tone']
> = {
  queued: 'muted',
  running: 'amber',
  done: 'good',
  failed: 'danger',
};

function relativeTime(s: string): string {
  // Backend returns 'YYYY-MM-DD HH:MM:SS' (UTC).
  const iso = s.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return s;
  const delta = Date.now() - t;
  const m = Math.floor(delta / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function JobCard({ job }: { job: JobSummary }) {
  const label = TEMPLATE_LABEL[job.templateId] ?? job.templateId;
  const isRunning = job.status === 'running';
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';

  return (
    <Card padding="snug" className={styles.card}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <SerifDisplay size="sm" as="h3">{label}</SerifDisplay>
          <MonoLabel tone="dim">JOB · {job.id.slice(0, 8)}</MonoLabel>
        </div>
        <Pill tone={STATUS_TONE[job.status]} dot={isRunning || isDone || isFailed}>
          {isRunning ? <Loader2 size={10} className={styles.spin} /> : null}
          {job.status}
        </Pill>
      </div>

      <div className={styles.metaRow}>
        <Chip subtle>{relativeTime(job.createdAt)}</Chip>
        {isRunning && job.stage && <Chip>STAGE · {job.stage}</Chip>}
        {job.finishedAt && (
          <Chip subtle>fin · {relativeTime(job.finishedAt)}</Chip>
        )}
      </div>

      {isFailed && (
        <div className={styles.failed}>
          <AlertCircle size={13} />
          <span>Render didn't finish. Re-queue from a fresh session.</span>
        </div>
      )}

      {isDone && (
        <a
          href={`/jobs/${job.id}/output`}
          download
          className={styles.dlBtn}
        >
          <Download size={13} />
          <span>Download output</span>
        </a>
      )}
    </Card>
  );
}
