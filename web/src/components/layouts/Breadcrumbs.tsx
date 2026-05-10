import { Link, useLocation, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const TITLES: Record<string, string> = {
  jobs: 'Jobs',
  presets: 'Presets',
  settings: 'Settings',
};

// URL-driven crumb trail: "/jobs" → "Jobs", "/jobs/abc123" → "Jobs › abc123",
// "/presets" → "Presets". Falls back to capitalising unknown segments.
export function Breadcrumbs() {
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs: { label: string; to: string }[] = [];
  let path = '';
  for (const seg of segments) {
    path += '/' + seg;
    let label = TITLES[seg];
    if (!label) {
      // Probably a job id — render it as a short mono-style chip
      label = params.id && seg === params.id ? seg.slice(0, 8) : seg;
    }
    crumbs.push({ label, to: path });
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.to} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 opacity-50" />}
            {isLast ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.to}
                className="hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
