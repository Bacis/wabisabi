// Themes page — pixel-faithful translation of docs/design-system/
// "Caption Studio Themes.html". Live data: pulls themes the user saved out
// of the /lab composer via createTheme, and adapts each backend Theme into
// the GridTheme shape the design's card layout expects. The hardcoded GRID
// below stays as a curated fallback so the page never reads as empty.

import { useEffect, useMemo, useState } from 'react';
import { fetchThemes, type Theme } from '@/lib/api';
import { PAIRING_BY_ID, loadCaptionFonts } from '../pages/lab/data/fonts';
import styles from './ThemesPage.module.css';

type TileColor =
  | 'lime'
  | 'pink'
  | 'blue'
  | 'violet'
  | 'cyan'
  | 'tang'
  | 'cream'
  | 'ink';

type StyleVariant = 'pop' | 'bold-style' | 'edit-style';

type FilterId =
  | 'all'
  | 'originals'
  | 'pop'
  | 'editorial'
  | 'bold'
  | 'cinema'
  | 'saved';

type GridTheme = {
  id: string;
  name: string;
  tile: TileColor;
  style: StyleVariant;
  badge?: { label: string; tone: 'ink' | 'lime' };
  preview: { l1: string; l2: string };
  tags: string[];
  rating: number;
  // Which filter buckets the card belongs to (besides 'all').
  filters: ReadonlyArray<Exclude<FilterId, 'all' | 'saved'>>;
  // True when the current viewer authored this theme — drives the "Saved"
  // filter and the row's badge.
  isOwner: boolean;
  // Mini caption rendered in the theme's actual palette + fonts.
  livePreview: LivePreview;
};

type LivePreview = {
  bg: string;
  ink: string;
  accents: [string, string, string, string];
  fontSans: string; // CSS font stack
  fontSerif: string; // CSS font stack
  words: string[];
  punchIdx: number; // index within `words` that renders as the PUNCH
};

type FeaturedTheme = {
  variant: 'a' | 'b';
  tag: { label: string; live: boolean };
  title: { sans: string; pop: string };
  description: string;
  swatches: string[];
  meta: string[];
  preview: { l1: string; l2: string };
  // When present, the right-pane preview renders the real theme caption
  // instead of the design's static gradient placeholder.
  livePreview?: LivePreview;
};

const FILTERS: ReadonlyArray<{
  id: FilterId;
  label: string;
  swatch?: string;
  icon?: 'heart';
}> = [
  { id: 'all', label: 'All' },
  { id: 'originals', label: 'Originals', swatch: 'var(--lime)' },
  { id: 'pop', label: 'Pop', swatch: 'var(--pink)' },
  { id: 'editorial', label: 'Editorial', swatch: 'var(--cyan)' },
  { id: 'bold', label: 'Bold', swatch: 'var(--tang)' },
  { id: 'cinema', label: 'Cinema', swatch: 'var(--violet)' },
  { id: 'saved', label: 'Saved', icon: 'heart' },
];

export function ThemesPage() {
  const [activeFilter, setActiveFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const [savedThemes, setSavedThemes] = useState<Theme[]>([]);

  // The lab loads caption fonts on mount; mirror it here so saved-theme
  // card previews render in the right family even if the user lands
  // straight on /themes without visiting /lab.
  useEffect(() => {
    loadCaptionFonts();
  }, []);

  // Load DB-backed themes — anything the user saved out of /lab + any
  // community-published themes. Fail silently (e.g. logged-out viewer);
  // the grid renders empty with a CTA when there's nothing yet.
  useEffect(() => {
    let cancelled = false;
    fetchThemes()
      .then((list) => {
        if (!cancelled) setSavedThemes(list);
      })
      .catch(() => {
        // Auth / network issue — leave savedThemes empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // All themes come from the DB now. Adapted into GridTheme shape; tile
  // color cycles through the design palette so the catalog doesn't read
  // as one uniform stripe.
  const merged = useMemo(() => {
    return savedThemes
      .map((t, i) => adaptSavedTheme(t, i))
      .filter((g): g is GridTheme => g !== null);
  }, [savedThemes]);

  // Featured pair — first 2 saved themes (most recent first per the
  // backend's ORDER BY), alternating the a/b card variant. May be empty
  // if the user hasn't saved anything yet; render hides the section in
  // that case.
  const featuredPair = useMemo<ReadonlyArray<FeaturedTheme>>(() => {
    return savedThemes
      .slice(0, 2)
      .map((t, i) => adaptFeaturedTheme(t, i === 0 ? 'a' : 'b'))
      .filter((f): f is FeaturedTheme => f !== null);
  }, [savedThemes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((t) => {
      if (activeFilter === 'saved') {
        // "Saved" tab = themes the current user authored (round-trip via
        // backend's isOwner flag, carried through on adapted GridThemes).
        if (!t.isOwner) return false;
      } else if (
        activeFilter !== 'all' &&
        !(t.filters as ReadonlyArray<string>).includes(activeFilter)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        t.preview.l1.toLowerCase().includes(q) ||
        t.preview.l2.toLowerCase().includes(q)
      );
    });
  }, [merged, activeFilter, query]);

  return (
    <main className={styles.main}>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.pageH}>
            Caption <span className={styles.accent}>themes</span>
            <span className={styles.stop}>.</span>
          </h1>
          <p className={styles.pageSub}>
            {merged.length === 0
              ? 'Nothing in the catalog yet — head to the lab to compose your first.'
              : merged.length === 1
                ? 'One theme so far. Reroll in the lab and save another to start a collection.'
                : `${merged.length} themes composed in the lab. Pick one, remix it, or save another from a fresh roll.`}
          </p>
        </div>
      </header>

      <div className={styles.filterRow}>
        <div className={styles.filterPills} role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={activeFilter === f.id}
              className={activeFilter === f.id ? styles.on : ''}
              onClick={() => setActiveFilter(f.id)}
            >
              {f.swatch && (
                <span
                  className={styles.swatch}
                  style={{ background: f.swatch }}
                  aria-hidden="true"
                />
              )}
              {f.icon === 'heart' && <HeartIcon />}
              {f.label}
              {f.id === 'all' && (
                <span className={styles.allCount}>·{merged.length}</span>
              )}
            </button>
          ))}
        </div>

        <label className={styles.search}>
          <SearchIcon />
          <input
            type="text"
            placeholder='Search themes — "italic", "kinetic", "quiet"…'
            aria-label="Search themes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {featuredPair.length > 0 && (
        <section className={styles.featured} aria-label="Featured themes">
          {featuredPair.map((f) => (
            <FeaturedCard key={f.variant} {...f} />
          ))}
        </section>
      )}

      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>
          <span className={styles.pip} aria-hidden="true" />
          All themes
        </div>
        <a href="/lab" className={styles.sectionAction}>
          Compose a new one with wabisabi
          <ArrowIcon />
        </a>
      </div>

      {filtered.length > 0 ? (
        <section className={styles.grid} aria-label="All themes">
          {filtered.map((t) => (
            <ThemeCard key={t.id} {...t} />
          ))}
        </section>
      ) : (
        <section className={styles.emptyState} aria-label="No themes">
          <h3 className={styles.emptyTitle}>
            {merged.length === 0
              ? 'Catalog is empty'
              : 'No themes match your filter'}
          </h3>
          <p className={styles.emptyHint}>
            {merged.length === 0
              ? 'Themes live where they\'re composed. Open the lab, roll a look you like, hit Save theme — it lands right here.'
              : 'Try a different filter or clear the search.'}
          </p>
          {merged.length === 0 && (
            <a href="/lab" className={styles.emptyCta}>
              Open the lab
              <ArrowIcon />
            </a>
          )}
        </section>
      )}
    </main>
  );
}

function FeaturedCard({
  variant,
  tag,
  title,
  description,
  swatches,
  meta,
  preview,
  livePreview,
}: FeaturedTheme) {
  return (
    <article
      className={[styles.featCard, variant === 'a' ? styles.featA : styles.featB]
        .filter(Boolean)
        .join(' ')}
      tabIndex={0}
    >
      <div className={styles.featInfo}>
        <span className={styles.featTag}>
          {tag.live && <span className={styles.d} aria-hidden="true" />}
          {tag.label}
        </span>
        <h2
          className={styles.featTitle}
          style={
            livePreview ? { fontFamily: livePreview.fontSans } : undefined
          }
        >
          {title.sans}{' '}
          <span
            className={styles.featPop}
            style={
              livePreview
                ? { fontFamily: livePreview.fontSerif, fontStyle: 'italic' }
                : undefined
            }
          >
            {title.pop}
          </span>
        </h2>
        <p className={styles.featDesc}>{description}</p>
        <div className={styles.featMeta}>
          <span className={styles.chip}>
            <span className={styles.sw}>
              {swatches.map((s, i) => (
                <span key={i} style={{ background: s }} />
              ))}
            </span>
            {swatches.length} colours
          </span>
          {meta.map((m) => (
            <span key={m} className={styles.chip}>
              {m}
            </span>
          ))}
        </div>
        <a href="/lab" className={styles.featCta}>
          Use this theme
          <ArrowIcon />
        </a>
      </div>
      <div className={styles.featPreview} aria-hidden="true">
        {livePreview ? (
          <LiveThemePreview {...livePreview} />
        ) : (
          <div className={styles.featCap}>
            <span className={styles.featL1}>{preview.l1}</span>
            <span className={styles.featL2}>{preview.l2}</span>
          </div>
        )}
      </div>
    </article>
  );
}

function ThemeCard({
  name,
  tile,
  style,
  badge,
  preview,
  tags,
  rating,
  livePreview,
}: GridTheme) {
  const tileClass = styles[tile] ?? '';
  const styleClass =
    style === 'bold-style'
      ? styles.boldStyle
      : style === 'edit-style'
        ? styles.editStyle
        : '';
  return (
    <article
      className={[styles.tcard, tileClass, styleClass].filter(Boolean).join(' ')}
      tabIndex={0}
    >
      <div className={styles.th}>
        <div className={styles.name}>{name}</div>
        <div className={styles.stars}>
          <StarIcon />
          {rating.toFixed(1)}
        </div>
      </div>
      {badge && (
        <div className={styles.badgeRow}>
          <span
            className={[styles.pin, badge.tone === 'lime' ? styles.pinLime : '']
              .filter(Boolean)
              .join(' ')}
          >
            {badge.label}
          </span>
        </div>
      )}
      <div className={styles.preview}>
        {livePreview ? (
          <LiveThemePreview {...livePreview} />
        ) : (
          <div className={styles.cap}>
            <span className={styles.l1}>{preview.l1}</span>
            <span className={styles.l2}>{preview.l2}</span>
          </div>
        )}
      </div>
      <div className={styles.infoRow}>
        <div className={styles.tags}>
          {tags.map((t) => (
            <span key={t} className={styles.tag}>
              {t}
            </span>
          ))}
        </div>
        <button type="button" className={styles.use}>
          Use <ArrowIcon />
        </button>
      </div>
    </article>
  );
}

// Mini caption preview rendered inside a card. Mirrors the lab's caption
// structure (sans body + italic-serif emphasis + display-scale PUNCH) at a
// fraction of the size. Animates on mount (once, via key bump) and on
// hover. Stagger comes from a per-word --i custom property the CSS reads
// into `animation-delay`.
function LiveThemePreview({
  bg,
  ink,
  accents,
  fontSans,
  fontSerif,
  words,
  punchIdx,
}: LivePreview) {
  return (
    <div
      className={styles.livePreview}
      style={
        {
          background: bg,
          color: ink,
          '--cap-sans': fontSans,
          '--cap-serif': fontSerif,
          '--color01': accents[0],
          '--color02': accents[1],
          '--color03': accents[2],
          '--color04': accents[3],
        } as React.CSSProperties
      }
    >
      <div className={styles.livePreviewCaption}>
        {words.map((w, i) => {
          if (i === punchIdx) {
            return (
              <span
                key={i}
                className={styles.livePreviewPunch}
                style={
                  {
                    color: accents[0],
                    ['--i' as never]: i,
                  } as React.CSSProperties
                }
              >
                {w}
              </span>
            );
          }
          // Every third word renders as italic-serif emphasis; the rest as
          // sans body. Both rotate accent slots so all 4 colours surface.
          const italic = i % 3 === 1;
          const accentIdx = (italic ? 2 : 0) + (Math.floor(i / 2) % 2);
          return (
            <span
              key={i}
              className={italic ? styles.livePreviewItalic : styles.livePreviewBody}
              style={
                {
                  color: accents[accentIdx] ?? accents[0],
                  ['--i' as never]: i,
                } as React.CSSProperties
              }
            >
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Map a lab category to one of the design's filter buckets. The lab has 9
// categories; the design has 5 (Originals carries the isOwner signal
// separately, Saved is "current user"). Best-effort assignment so saved
// themes still answer to the curated chips.
const CATEGORY_TO_FILTERS: Record<string, ReadonlyArray<'pop' | 'editorial' | 'bold' | 'cinema'>> = {
  cinematic: ['cinema'],
  vibrant: ['pop'],
  neon: ['pop'],
  pastel: ['editorial'],
  editorial: ['editorial'],
  earth: ['bold'],
  retro: ['pop', 'bold'],
  mono: ['editorial'],
  light: ['editorial'],
};

// Cycle tile colors across saved themes so a long list doesn't read as
// one uniform stripe. Keyed by index so we get a stable repeating sequence.
const TILE_CYCLE: ReadonlyArray<TileColor> = [
  'pink',
  'lime',
  'violet',
  'cyan',
  'tang',
  'blue',
  'ink',
  'cream',
];

function adaptSavedTheme(t: Theme, idx: number): GridTheme | null {
  const lab = (t.styleSpec as { lab?: Record<string, unknown> })?.lab;
  if (!lab) return null;
  const sceneText = typeof lab.sceneText === 'string' ? lab.sceneText : '';
  const words = sceneText.split(/\s+/).filter(Boolean);
  const punchIdx =
    typeof lab.scenePunch === 'number' ? lab.scenePunch : Math.max(0, words.length - 1);
  // Preview: pull two words near the punch for a tight l1/l2 pair, fall back
  // to the theme name + "saved" if the scene text is missing.
  const l2 = words[punchIdx] ?? t.name;
  const l1 = words[Math.max(0, punchIdx - 1)] ?? 'preview';
  const cat = typeof lab.themeCategory === 'string' ? lab.themeCategory : '';
  const filters = CATEGORY_TO_FILTERS[cat] ?? ['pop'];
  const badge: GridTheme['badge'] = t.isOwner
    ? { label: 'Yours', tone: 'lime' }
    : { label: 'Community', tone: 'ink' };

  // Live preview is required — themes without enough lab data to render
  // a real preview are dropped here so the catalog only ever shows real
  // composer outputs.
  const livePreview = buildLivePreview(lab, words, punchIdx);
  if (!livePreview) return null;

  return {
    id: t.id,
    name: t.name,
    tile: TILE_CYCLE[idx % TILE_CYCLE.length],
    style: cat === 'editorial' || cat === 'pastel' ? 'edit-style' : 'pop',
    badge,
    preview: { l1: l1.toLowerCase(), l2: l2.toUpperCase() },
    tags: [
      cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : 'Theme',
      typeof lab.bodyFxId === 'string' ? formatFxLabel(lab.bodyFxId) : 'Plain',
    ],
    rating: 5.0,
    filters: t.isOwner ? ['originals', ...filters] : filters,
    isOwner: t.isOwner,
    livePreview,
  };
}

// Convert a DB theme into a FeaturedTheme for the hero pair. Splits the
// name across sans + pop halves, derives the description from scene + fx
// metadata, lists accents as swatches, and embeds a live preview so the
// right-pane shows the real caption look. Returns null when the styleSpec
// is missing lab data (legacy non-lab themes shouldn't surface here).
function adaptFeaturedTheme(t: Theme, variant: 'a' | 'b'): FeaturedTheme | null {
  const lab = (t.styleSpec as { lab?: Record<string, unknown> })?.lab;
  if (!lab) return null;
  const sceneText = typeof lab.sceneText === 'string' ? lab.sceneText : '';
  const allWords = sceneText.split(/\s+/).filter(Boolean);
  const punchIdx =
    typeof lab.scenePunch === 'number'
      ? lab.scenePunch
      : Math.max(0, allWords.length - 1);
  const livePreview = buildLivePreview(lab, allWords, punchIdx);

  // Title split: take the last word of the theme name into the italic
  // "pop" half. Single-word names get the category as the pop half.
  const nameWords = t.name.trim().split(/\s+/);
  let titleSans = t.name;
  let titlePop = '';
  if (nameWords.length >= 2) {
    titleSans = nameWords.slice(0, -1).join(' ');
    titlePop = nameWords[nameWords.length - 1];
  } else {
    titlePop =
      typeof lab.themeCategory === 'string'
        ? lab.themeCategory.charAt(0).toUpperCase() + lab.themeCategory.slice(1)
        : 'Theme';
  }

  const accentsRaw = lab.themeAccents as Record<string, unknown> | undefined;
  const swatches = accentsRaw
    ? [
        String(accentsRaw.c1 ?? '#fff'),
        String(accentsRaw.c2 ?? '#fff'),
        String(accentsRaw.c3 ?? '#fff'),
      ]
    : ['#fff', '#fff', '#fff'];

  const meta: string[] = [];
  // Pairing name — best-effort: PAIRING_BY_ID lookup, else "Font pair".
  if (typeof lab.pairingId === 'string') {
    const p = PAIRING_BY_ID[lab.pairingId];
    if (p) meta.push(`${p.sans[1]} · ${p.serif[1]}`);
  }
  if (typeof lab.bodyFxId === 'string' && typeof lab.emphasisFxId === 'string') {
    meta.push(
      `${formatFxLabel(lab.bodyFxId)} → ${formatFxLabel(lab.emphasisFxId)}`,
    );
  }

  const description =
    t.description ||
    `Saved from /lab — ${typeof lab.themeName === 'string' ? lab.themeName : t.name} palette on ${
      typeof lab.sceneId === 'string' ? lab.sceneId : 'a scene'
    }.`;

  const l1 = allWords[Math.max(0, punchIdx - 1)] ?? 'preview';
  const l2 = allWords[punchIdx] ?? t.name;

  return {
    variant,
    tag: {
      label: t.isOwner ? 'Your theme' : 'Community pick',
      live: true,
    },
    title: { sans: titleSans, pop: titlePop },
    description,
    swatches,
    meta,
    preview: { l1, l2 },
    livePreview,
  };
}

function buildLivePreview(
  lab: Record<string, unknown>,
  allWords: string[],
  punchIdx: number,
): LivePreview | undefined {
  const bg = typeof lab.themeBg === 'string' ? lab.themeBg : null;
  const ink = typeof lab.themeInk === 'string' ? lab.themeInk : '#FFFFFF';
  const accentsRaw = lab.themeAccents as Record<string, unknown> | undefined;
  if (!bg || !accentsRaw) return undefined;
  const c1 = String(accentsRaw.c1 ?? ink);
  const c2 = String(accentsRaw.c2 ?? c1);
  const c3 = String(accentsRaw.c3 ?? c1);
  const c4 = String(accentsRaw.c4 ?? c1);
  const pairing =
    typeof lab.pairingId === 'string' ? PAIRING_BY_ID[lab.pairingId] : null;
  const fontSans = pairing ? pairing.sans[0] : `'Inter',sans-serif`;
  const fontSerif = pairing
    ? pairing.serif[0]
    : `'Playfair Display',Georgia,serif`;

  // Clip the scene to ~6 words around the punch so the card preview never
  // overflows. If the original is shorter, just use the whole scene.
  let start = 0;
  let end = allWords.length;
  if (allWords.length > 6) {
    start = Math.max(0, Math.min(allWords.length - 6, punchIdx - 2));
    end = start + 6;
  }
  const slice = allWords.slice(start, end);
  const slicedPunchIdx = Math.max(0, Math.min(slice.length - 1, punchIdx - start));

  return {
    bg,
    ink,
    accents: [c1, c2, c3, c4],
    fontSans,
    fontSerif,
    words: slice,
    punchIdx: slicedPunchIdx,
  };
}

function formatFxLabel(fxId: string): string {
  // 'we-stair' → 'Stair', 'we-rgb-split' → 'Rgb Split'
  return fxId
    .replace(/^we-/, '')
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className={styles.ico} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" className={styles.ico} aria-hidden="true">
      <path d="M12 21l-8-7c-3-3-3-7 0-10 2-2 5-2 8 1 3-3 6-3 8-1 3 3 3 7 0 10z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className={styles.ico} aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" className={styles.icoFill} aria-hidden="true">
      <path
        d="M12 3l2.6 7H22l-6 4.6L18 21l-6-4-6 4 2-7.4L2 9h7.4z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
