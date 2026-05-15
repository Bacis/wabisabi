// /designer/history — list past designer sessions for the signed-in user.
// Each card resumes the conversation at /designer/:id with the editor state
// and chat transcript restored.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
// Link is used for the per-session card; Button uses a plain anchor to match
// the existing JobsPage / ThemesPage CTA pattern.
import {
  Button,
  Card,
  Chip,
  EmptyState,
  MonoLabel,
  PageHeader,
  SerifDisplay,
  atelierStyles as a,
} from '@/components/atelier';
import {
  listDesignerSessions,
  type DesignerSessionSummary,
} from '@/lib/api';
import styles from './DesignerHistoryPage.module.css';

const TEMPLATE_LABEL: Record<string, string> = {
  'reel-clone': 'Cinematic',
  'pop-words': 'Pop Words',
  'caption-designer': 'Caption Designer',
};

function relativeTime(s: string): string {
  // SQLite default datetime is 'YYYY-MM-DD HH:MM:SS' in UTC; coerce to ISO.
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

export function DesignerHistoryPage() {
  const [sessions, setSessions] = useState<DesignerSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDesignerSessions()
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`${a.page} ${a.wide}`}>
      <PageHeader
        eyebrow={
          <MonoLabel tone="cyan" dot>
            Designer History · {sessions?.length ?? '—'}
          </MonoLabel>
        }
        title={<SerifDisplay size="xl">Every conversation, kept.</SerifDisplay>}
        description="Past sessions with the caption agent. Reopen one to pick up where you left off — your source, transcript, and last applied style are all restored."
        rightSlot={
          <Button
            as="a"
            href="/"
            variant="cyan"
            leadingIcon={<Bot size={13} />}
          >
            New session
          </Button>
        }
      />

      {error && (
        <div className={styles.errorBox}>
          <MonoLabel tone="danger" dot>Couldn't load history</MonoLabel>
          <span>{error}</span>
        </div>
      )}

      {!sessions ? (
        <div className={`${a.grid} ${a.themes}`}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          title={<em>No sessions yet.</em>}
          body="Start a new conversation with the agent and it will land here."
          action={
            <Button
              as="a"
              href="/"
              variant="cyan"
              leadingIcon={<Bot size={13} />}
            >
              Open agent
            </Button>
          }
        />
      ) : (
        <div className={`${a.grid} ${a.themes}`}>
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: DesignerSessionSummary }) {
  const templateLabel = TEMPLATE_LABEL[session.templateId] ?? session.templateId;
  const posterSrc =
    session.sourceKind === 'stock'
      ? `/stock/${session.sourceId}/clip.mp4`
      : null;

  return (
    <Card padding="none" interactive className={styles.card}>
      <Link to={`/designer/${session.id}`} className={styles.cardLink}>
        <div className={styles.poster}>
          {posterSrc ? (
            <video
              src={posterSrc}
              muted
              loop
              playsInline
              preload="metadata"
              onMouseEnter={(e) => void e.currentTarget.play()}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
            />
          ) : (
            <div className={styles.posterFallback}>
              <MonoLabel tone="dim">Uploaded clip</MonoLabel>
            </div>
          )}
        </div>
        <div className={styles.foot}>
          <SerifDisplay size="sm" as="h3" className={styles.title}>
            {session.title}
          </SerifDisplay>
          <div className={styles.metaRow}>
            <Chip subtle>{templateLabel}</Chip>
            <Chip subtle>{relativeTime(session.updatedAt)}</Chip>
          </div>
          <MonoLabel tone="dim">
            SESSION · {session.id.slice(0, 8)}
          </MonoLabel>
        </div>
      </Link>
    </Card>
  );
}
