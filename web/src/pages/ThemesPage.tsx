import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { fetchThemes, type Theme } from '@/lib/api';
import { ThemeCard } from './themes/ThemeCard';

type Buckets = {
  drafts: Theme[];
  ownPublished: Theme[];
  community: Theme[];
};

function bucketize(themes: Theme[]): Buckets {
  const drafts: Theme[] = [];
  const ownPublished: Theme[] = [];
  const community: Theme[] = [];
  for (const t of themes) {
    if (t.isOwner && !t.isPublished) drafts.push(t);
    else if (t.isOwner && t.isPublished) ownPublished.push(t);
    else if (t.isPublished) community.push(t);
  }
  return { drafts, ownPublished, community };
}

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

  const buckets = useMemo(() => (themes ? bucketize(themes) : null), [themes]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Themes</h1>
          <p className="text-sm text-muted-foreground">
            Reusable caption looks. Build a theme on a stock clip, save it,
            then publish for others to remix.
          </p>
        </div>
        <Button asChild>
          <Link to="/themes/new">New theme</Link>
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </div>
      )}

      {!buckets ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          <Section
            title="Your drafts"
            empty="No drafts. Create a theme to get started."
            themes={buckets.drafts}
          />
          <Section
            title="Your published"
            empty="None published yet."
            themes={buckets.ownPublished}
          />
          <Section
            title="Community"
            empty="No community themes yet."
            themes={buckets.community}
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  themes,
}: {
  title: string;
  empty: string;
  themes: Theme[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <span className="ml-2 font-mono text-[11px]">{themes.length}</span>
      </h2>
      {themes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center text-xs text-muted-foreground">
          {empty}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} />
          ))}
        </div>
      )}
    </section>
  );
}
