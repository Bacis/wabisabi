import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { JobSummary } from '@/lib/api';

const TEMPLATE_LABEL: Record<string, string> = {
  'reel-clone': 'Cinematic',
  'pop-words': 'Pop Words',
};

// Badge variant per status. shadcn's Badge uses CVA variants; we lean on
// the destructive variant for failures and outline for terminal-ish states.
const STATUS_TONE: Record<JobSummary['status'], string> = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

function formatTime(s: string): string {
  // Backend returns 'YYYY-MM-DD HH:MM:SS' (UTC). Show just the time
  // portion for compactness; the date is mostly redundant in a list of
  // recent jobs.
  const parts = s.split(' ');
  return parts.length >= 2 ? parts[1]! : s;
}

export function JobCard({ job }: { job: JobSummary }) {
  const label = TEMPLATE_LABEL[job.templateId] ?? job.templateId;
  const isRunning = job.status === 'running';
  const isQueued = job.status === 'queued';
  const isFailed = job.status === 'failed';
  const editable = job.status === 'running' || job.status === 'done' || isFailed;

  return (
    <Card className="group flex flex-col overflow-hidden transition-colors hover:border-primary/50">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <div className="text-base font-semibold">{label}</div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {job.id.slice(0, 8)}
          </div>
        </div>
        {isFailed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn('cursor-help', STATUS_TONE[job.status])}
              >
                {job.status}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Render failed — open editor for details.</TooltipContent>
          </Tooltip>
        ) : (
          <Badge variant="outline" className={STATUS_TONE[job.status]}>
            {isRunning && <Loader2 className="mr-1 size-3 animate-spin" />}
            {job.status}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="flex-1 space-y-2 text-sm">
        {isRunning && job.stage && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>Stage: {job.stage}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="size-3" />
          <span>
            Created {formatTime(job.createdAt)}
            {job.finishedAt && ` · finished ${formatTime(job.finishedAt)}`}
          </span>
        </div>
      </CardContent>

      <CardFooter className="border-t pt-3">
        <Button
          asChild
          variant="ghost"
          className="w-full justify-between"
          disabled={!editable}
        >
          <Link to={`/jobs/${job.id}`} aria-disabled={!editable}>
            <span>{isQueued ? 'Waiting to transcribe…' : 'Open editor'}</span>
            <ArrowUpRight className="size-4 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
