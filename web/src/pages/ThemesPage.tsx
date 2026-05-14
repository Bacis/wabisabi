// Read-only theme gallery. Theme creation/editing now happens via the agent
// at /agent/new; this page lists drafts and published themes.

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Bot } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  MonoLabel,
  PageHeader,
  Pill,
  SerifDisplay,
  atelierStyles as a,
} from '@/components/atelier';
import { fetchThemes, type Theme } from '@/lib/api';
import styles from './ThemesPage.module.css';

type Buckets = { yours: Theme[]; community: Theme[] };

export function ThemesPage() {
  const [themes, setThemes] = useState<Theme[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchThemes()
      .then((list) => {
        if (!cancelled) setThemes(list);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buckets = useMemo<Buckets | null>(() => {
    if (!themes) return null;
    const yours: Theme[] = [];
    const community: Theme[] = [];
    for (const t of themes) {
      if (t.isOwner) yours.push(t);
      else if (t.isPublished) community.push(t);
    }
    return { yours, community };
  }, [themes]);

  return (
    <div className={`${a.page} ${a.wide}`}>
      <PageHeader
        eyebrow={
          <MonoLabel tone="cyan" dot>
            Theme Gallery · {themes?.length ?? '—'}
          </MonoLabel>
        }
        title={<SerifDisplay size="xl">Captions, in dialect.</SerifDisplay>}
        description="Published looks from you and the community. Themes are authored through the agent — there's no separate editor."
        rightSlot={
          <Button
            as="a"
            href="/agent/new"
            variant="cyan"
            leadingIcon={<Bot size={13} />}
          >
            New theme
          </Button>
        }
      />

      {error && (
        <div className={styles.errorBox}>
          <MonoLabel tone="danger" dot>Couldn't load themes</MonoLabel>
          <span>{error}</span>
        </div>
      )}

      {!buckets ? (
        <div className={`${a.grid} ${a.themes}`}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : (
        <div className={styles.sections}>
          <Section
            label="Your work"
            count={buckets.yours.length}
            themes={buckets.yours}
            empty="You haven't authored a theme yet."
          />
          <Section
            label="Community"
            count={buckets.community.length}
            themes={buckets.community}
            empty="The community shelf is empty."
          />
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  themes,
  empty,
}: {
  label: string;
  count: number;
  themes: Theme[];
  empty: string;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <MonoLabel tone="bright">
          {label} · {count}
        </MonoLabel>
        <span className={styles.rule} aria-hidden="true" />
      </div>
      {themes.length === 0 ? (
        <EmptyState title={<em>{empty}</em>} />
      ) : (
        <div className={`${a.grid} ${a.themes}`}>
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function ThemeCard({ theme }: { theme: Theme }) {
  const showcasePoster = theme.showcaseClipId
    ? `/stock/${theme.showcaseClipId}/clip.mp4`
    : null;
  return (
    <Card padding="none" interactive className={styles.themeCard}>
      <div className={styles.poster}>
        {showcasePoster ? (
          <video
            src={showcasePoster}
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
            <Sparkles size={24} />
          </div>
        )}
        <div className={styles.posterTopRight}>
          {theme.isPublished ? (
            <Pill tone="amber" dot>Published</Pill>
          ) : (
            <Pill tone="muted">Draft</Pill>
          )}
        </div>
      </div>
      <div className={styles.themeFoot}>
        <SerifDisplay size="sm" as="h3" className={styles.themeName}>
          {theme.name}
        </SerifDisplay>
        <MonoLabel tone="dim">
          {theme.isOwner ? 'BY YOU' : `BY ${theme.authorEmail ?? 'COMMUNITY'}`}
        </MonoLabel>
        {theme.description && (
          <p className={styles.themeDesc}>{theme.description}</p>
        )}
      </div>
    </Card>
  );
}
