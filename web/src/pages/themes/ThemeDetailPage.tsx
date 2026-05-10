import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  deleteTheme,
  fetchTheme,
  publishTheme,
  unpublishTheme,
  type ThemeWithShowcase,
} from '@/lib/api';
import { Editor } from '@/components/Editor';

const TEMPLATE_LABEL: Record<string, string> = {
  'reel-clone': 'Cinematic',
  'pop-words': 'Pop Words',
};

export function ThemeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeWithShowcase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchTheme(id)
      .then((t) => {
        if (!cancelled) setTheme(t);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="p-6 text-sm text-rose-300">
        {error}
        <div className="mt-3">
          <Link to="/themes" className="underline">
            Back to themes
          </Link>
        </div>
      </div>
    );
  }
  if (!theme) {
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading theme…
      </div>
    );
  }

  const togglePublish = async () => {
    if (!id) return;
    setPending(true);
    try {
      const updated = theme.isPublished
        ? await unpublishTheme(id)
        : await publishTheme(id);
      // Server returns Theme without showcaseClip, so merge with existing.
      setTheme({ ...theme, ...updated });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const onDelete = async () => {
    if (!id) return;
    if (!confirm(`Delete theme "${theme.name}"? This can't be undone.`)) return;
    setPending(true);
    try {
      await deleteTheme(id);
      navigate('/themes');
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  const byline = theme.isOwner
    ? 'by you'
    : theme.authorEmail
      ? `by ${theme.authorEmail}`
      : null;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{theme.name}</h1>
            <Badge variant={theme.isPublished ? 'default' : 'outline'}>
              {theme.isPublished ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {TEMPLATE_LABEL[theme.templateId] ?? theme.templateId}
            {byline ? ` · ${byline}` : ''}
            {theme.publishedAt && ` · published ${formatDate(theme.publishedAt)}`}
          </p>
          {theme.description && (
            <p className="text-sm text-muted-foreground max-w-prose">
              {theme.description}
            </p>
          )}
          {!theme.showcaseClip && (
            <p className="text-xs text-amber-400">
              No showcase clip — pick a stock clip to make this theme viewable.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {theme.isOwner && (
            <>
              <Button
                variant={theme.isPublished ? 'outline' : 'default'}
                onClick={togglePublish}
                disabled={pending || !theme.showcaseClip}
              >
                {theme.isPublished ? 'Unpublish' : 'Publish'}
              </Button>
              <Button variant="ghost" onClick={onDelete} disabled={pending}>
                Delete
              </Button>
            </>
          )}
          <Button variant="ghost" asChild>
            <Link to="/themes">Back</Link>
          </Button>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        {theme.showcaseClip ? (
          <Editor source={{ kind: 'theme', themeId: theme.id }} readOnly />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No showcase clip set.
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(s: string): string {
  const parts = s.split(' ');
  return parts[0] ?? s;
}
