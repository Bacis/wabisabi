// Caption Studio · wabisabi — Library page.
//
// A curated showcase of example renders + prompts. Source data lives in
// web/src/data/curatedRenders.ts; visitors copy a prompt to clipboard via
// the "Copy prompt" CTA on every card. This page intentionally does NOT
// show a user's own jobs — the lifecycle / live-status / download flow
// lives elsewhere. When the curated list is empty, we show a friendly
// empty state so the page never looks broken.

import { useMemo, useState } from 'react';
import {
  CURATED_RENDERS,
  type CuratedRender,
  type CuratedRenderStatus,
} from '@/data/curatedRenders';
import styles from './LibraryPage.module.css';

type StatusFilter = 'all' | CuratedRenderStatus;

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'done', label: 'Ready' },
  { id: 'processing', label: 'Rendering' },
  { id: 'queued', label: 'Queued' },
  { id: 'failed', label: 'Failed' },
];

export function LibraryPage() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: CURATED_RENDERS.length,
      done: 0,
      processing: 0,
      queued: 0,
      failed: 0,
    };
    for (const r of CURATED_RENDERS) out[r.status] += 1;
    return out;
  }, []);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CURATED_RENDERS.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.clipLine.toLowerCase().includes(q) ||
        r.prompt.toLowerCase().includes(q) ||
        r.capA.toLowerCase().includes(q) ||
        r.capB.toLowerCase().includes(q)
      );
    });
  }, [filter, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CuratedRender[]>();
    for (const r of filteredItems) {
      const list = groups.get(r.group) ?? [];
      list.push(r);
      groups.set(r.group, list);
    }
    return Array.from(groups.entries());
  }, [filteredItems]);

  const themesCount = useMemo(() => {
    const names = new Set<string>();
    for (const r of CURATED_RENDERS) names.add(r.clipLine.split(' · ').pop() ?? '');
    return names.size;
  }, []);
  const clipsCount = useMemo(() => {
    const clips = new Set<string>();
    for (const r of CURATED_RENDERS) clips.add(r.clipLine.split(' · ')[0] ?? '');
    return clips.size;
  }, []);

  return (
    <div className={styles.scene}>
      <div className={styles.grain} />
      <main className={styles.page}>
        <section className={styles.head}>
          <div className={styles.headLeft}>
            <span className={styles.kicker}>
              <span className={styles.d} /> YOUR LIBRARY · {themesCount} THEMES ·{' '}
              {clipsCount} CLIPS
            </span>
            <h1 className={styles.headTitle}>
              Caption <span className={styles.accent}>library</span>.
            </h1>
            <p className={styles.headSub}>
              Every theme we&rsquo;ve crafted with wabisabi — copy the prompt to
              remix on a new clip, or open the Designer to start from scratch.
            </p>
          </div>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.filters}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`${styles.filt} ${filter === f.id ? styles.active : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className={styles.count}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className={styles.toolbarRight}>
            <label className={styles.search}>
              <svg
                className={styles.ico}
                width="13"
                height="13"
                viewBox="0 0 16 16"
                strokeWidth={1.4}
                style={{ color: 'var(--ag-ink-3)' }}
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5l3 3" />
              </svg>
              <input
                placeholder="Search by name, clip, or prompt…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className={styles.kbd}>⌘ K</span>
            </label>
            <button type="button" className={styles.iconBtn} title="Sort">
              <svg
                className={styles.ico}
                width="13"
                height="13"
                viewBox="0 0 16 16"
                strokeWidth={1.4}
              >
                <path d="M4 3v10M2 11l2 2 2-2M11 13V3M9 5l2-2 2 2" />
              </svg>
            </button>
            <div className={styles.viewToggle}>
              <button type="button" className={styles.active} title="Grid">
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <rect x="2" y="2" width="5" height="5" />
                  <rect x="9" y="2" width="5" height="5" />
                  <rect x="2" y="9" width="5" height="5" />
                  <rect x="9" y="9" width="5" height="5" />
                </svg>
              </button>
              <button type="button" title="List">
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.4}
                >
                  <path d="M2 4h12M2 8h12M2 12h12" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {grouped.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyKicker}>NOTHING TO SHOW</span>
            <h2 className={styles.emptyTitle}>
              No curated renders yet.
            </h2>
            <p className={styles.emptySub}>
              {CURATED_RENDERS.length === 0
                ? 'The Library is a hand-curated showcase. Add entries to web/src/data/curatedRenders.ts to populate this page.'
                : 'No renders match the current filters. Try clearing the search or selecting "All".'}
            </p>
          </div>
        ) : (
          grouped.map(([group, items]) => (
            <div key={group}>
              <div className={styles.groupHead}>
                <span className={styles.label}>
                  <b>{group}</b>
                </span>
                <span className={styles.line} />
                <span className={styles.label}>
                  {items.length} {items.length === 1 ? 'render' : 'renders'}
                </span>
              </div>
              <div className={styles.grid}>
                {items.map((r) => (
                  <RenderCard key={r.id} render={r} />
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}

function RenderCard({ render: r }: { render: CuratedRender }) {
  const [copied, setCopied] = useState(false);

  function onCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    navigator.clipboard?.writeText(r.prompt).catch(() => {
      // Clipboard may be unavailable (insecure context, denied permission);
      // still show the "copied" visual so the click feels responsive — the
      // failure mode is benign.
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const isFailed = r.status === 'failed';
  const cardClass = [
    styles.render,
    styles[r.palette],
    isFailed ? styles.failedCard : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={cardClass}>
      <div className={styles.thumb}>
        <div className={styles.bg} />
        <StatusBadge status={r.status} progressPct={r.progressPct} queuePosition={r.queuePosition} />
        <span className={styles.fmt}>{r.format}</span>
        {isFailed ? (
          <div className={styles.errOverlay}>
            <svg
              className={styles.ico}
              width="20"
              height="20"
              viewBox="0 0 16 16"
              strokeWidth={1.4}
              style={{ color: '#ff6b6b' }}
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v3.5M8 11v0.01" />
            </svg>
            <span className={styles.e}>{r.errorMessage ?? 'Render failed.'}</span>
            {r.errorMeta && <span className={styles.errMeta}>{r.errorMeta}</span>}
          </div>
        ) : (
          <>
            <div className={styles.cap}>
              <span className={styles.capA}>{r.capA}</span>
              <span className={styles.capB}>{r.capB}</span>
            </div>
            <span className={styles.duration}>{r.duration}</span>
            {r.status === 'done' && r.outputUrl && (
              <button
                type="button"
                className={styles.playBtn}
                aria-label="Play"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(r.outputUrl, '_blank');
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  stroke="none"
                >
                  <path d="M5 3l8 5-8 5z" />
                </svg>
              </button>
            )}
            {r.status === 'processing' && typeof r.progressPct === 'number' && (
              <div className={styles.progress}>
                <div
                  className={styles.bar}
                  style={{ width: `${Math.min(100, Math.max(0, r.progressPct))}%` }}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.title}>
          {r.title}
          {r.versionTag && (
            <span
              className={`${styles.versionTag} ${
                r.status === 'processing' ? styles.cyan : ''
              }`}
            >
              {r.versionTag}
            </span>
          )}
        </div>
        <div className={styles.clip}>{r.clipLine}</div>
        <div className={styles.metaRow}>
          <span className={styles.when}>{r.when}</span>
          <div className={styles.actions}>
            {r.status === 'done' && r.outputUrl && (
              <a
                className={`${styles.aBtn} ${styles.primary}`}
                href={r.outputUrl}
                title="Download"
                onClick={(e) => e.stopPropagation()}
                download
              >
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.5}
                >
                  <path d="M8 2v9M5 8l3 3 3-3M3 14h10" />
                </svg>
              </a>
            )}
            {r.status === 'failed' && (
              <button
                type="button"
                className={`${styles.aBtn} ${styles.primary}`}
                title="Retry"
                onClick={(e) => e.stopPropagation()}
              >
                <svg
                  className={styles.ico}
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  strokeWidth={1.5}
                >
                  <path d="M3 8a5 5 0 119 3.5M3 11v-3h3" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`${styles.copyPrompt} ${copied ? styles.copied : ''}`}
          onClick={onCopy}
        >
          <svg
            className={styles.ico}
            width="11"
            height="11"
            viewBox="0 0 16 16"
            strokeWidth={copied ? 1.8 : 1.5}
          >
            {copied ? (
              <path d="M3 8.5l3 3 7-7" />
            ) : (
              <>
                <rect x="5" y="5" width="9" height="9" rx="1.5" />
                <path d="M3 11V3a1 1 0 011-1h7" />
              </>
            )}
          </svg>
          {copied
            ? `Copied · ${r.prompt.length > 24 ? r.prompt.slice(0, 24) + '…' : r.prompt}`
            : 'Copy prompt'}
        </button>
      </div>
    </article>
  );
}

function StatusBadge({
  status,
  progressPct,
  queuePosition,
}: {
  status: CuratedRenderStatus;
  progressPct?: number;
  queuePosition?: number;
}) {
  if (status === 'done') {
    return (
      <span className={`${styles.badge} ${styles.done}`}>
        <span className={styles.d} /> Ready
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className={`${styles.badge} ${styles.processing}`}>
        <span className={styles.d} /> Rendering
        {typeof progressPct === 'number' ? ` · ${progressPct}%` : ''}
      </span>
    );
  }
  if (status === 'queued') {
    return (
      <span className={`${styles.badge} ${styles.queued}`}>
        <span className={styles.d} /> Queued
        {typeof queuePosition === 'number' ? ` · #${queuePosition}` : ''}
      </span>
    );
  }
  return (
    <span className={`${styles.badge} ${styles.failed}`}>
      <span className={styles.d} /> Failed
    </span>
  );
}
