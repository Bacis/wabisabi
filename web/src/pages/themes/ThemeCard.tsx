import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Theme } from '@/lib/api';

// Pull a representative palette from a theme's styleSpec. Reads
// color.fill + color.emphasisFill (which can be a single colour or an
// array). Renders up to 5 swatches; missing values are skipped silently.
function paletteFrom(styleSpec: Record<string, any>): string[] {
  const out: string[] = [];
  const fill = styleSpec?.color?.fill;
  if (typeof fill === 'string') out.push(fill);
  const ef = styleSpec?.color?.emphasisFill;
  if (Array.isArray(ef)) {
    for (const c of ef) {
      if (typeof c === 'string') out.push(c);
    }
  } else if (typeof ef === 'string') {
    out.push(ef);
  }
  const stroke = styleSpec?.color?.stroke;
  if (typeof stroke === 'string' && !out.includes(stroke)) out.push(stroke);
  return out.slice(0, 5);
}

const TEMPLATE_LABEL: Record<string, string> = {
  'reel-clone': 'Cinematic',
  'pop-words': 'Pop Words',
};

export function ThemeCard({ theme }: { theme: Theme }) {
  const palette = paletteFrom(theme.styleSpec);
  const byline = theme.isOwner
    ? 'by you'
    : theme.authorEmail
      ? `by ${theme.authorEmail}`
      : null;

  return (
    <Link to={`/themes/${theme.id}`} className="group block">
      <Card className="flex h-full flex-col transition-shadow group-hover:shadow-md">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight">{theme.name}</h3>
            <Badge variant={theme.isPublished ? 'default' : 'outline'}>
              {theme.isPublished ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {TEMPLATE_LABEL[theme.templateId] ?? theme.templateId}
            {byline ? ` · ${byline}` : ''}
          </p>
          {theme.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {theme.description}
            </p>
          )}
        </CardHeader>
        <CardContent className="mt-auto">
          {palette.length > 0 && (
            <div className="flex items-center gap-1.5">
              {palette.map((c, i) => (
                <span
                  key={i}
                  className="size-5 rounded-md border border-border/60"
                  style={{ background: c }}
                  title={c}
                />
              ))}
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                {palette.length === 1 ? '1 color' : `${palette.length} colors`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
