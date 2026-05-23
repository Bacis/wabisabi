// Caption Lab — Design System overview.
// Read-only catalogue of every token the lab can generate from: fonts (pool +
// theme-baked), themes (palette + typography + WCAG check), font pairings
// (emergent (display × sub × mono) triplets ranked by adoption), and effects.
//
// Data is pulled directly from ./data/* — there's no separate token store, so
// this page IS the source-of-truth view. Designers tweaking themes.ts /
// fonts.ts will see updates here on next reload.

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  Button,
  Card,
  MonoLabel,
  PageHeader,
  Pill,
  SerifDisplay,
  atelierStyles as a,
} from '@/components/atelier';
import { THEMES, type LabTheme } from './data/themes';
import {
  CAP_SANS_FONTS,
  CAP_SERIF_FONTS,
  FONT_IMPORTS,
  loadCaptionFonts,
} from './data/fonts';
import { WORD_FX } from './data/effects';
import { ensurePassing, wcagContrast, MIN_CONTRAST } from './engine/contrast';
import styles from './LabSystemPage.module.css';
import './animations.css';

// ─── Font catalogue ─────────────────────────────────────────────────────────
// Union of (a) what the randomizer pools (CAP_SANS_FONTS / CAP_SERIF_FONTS) and
// (b) every family any theme references in its display/sub/mono slot. Role
// inferred from where the family actually appears across themes.

type FontRole = 'display' | 'sub' | 'mono';
type FontCard = {
  family: string;
  fontFamily: string; // full CSS stack (e.g. `'Fraunces',Georgia,serif`)
  roles: Set<FontRole>;
  themes: LabTheme[];
  inSansPool: boolean;
  inSerifPool: boolean;
  googleFontsUrl: string | null;
};

const POOL_SANS_NAMES = new Set(CAP_SANS_FONTS.map(([, name]) => name));
const POOL_SERIF_NAMES = new Set(CAP_SERIF_FONTS.map(([, name]) => name));

// First quoted token in a CSS font-family stack — that's the canonical name.
function familyFromStack(stack: string): string {
  const m = stack.match(/^\s*'([^']+)'/) ?? stack.match(/^\s*"([^"]+)"/);
  if (m) return m[1];
  return stack.split(',')[0].trim();
}

function buildFontCatalogue(): FontCard[] {
  const byName = new Map<string, FontCard>();

  function touch(stack: string, role: FontRole, theme: LabTheme) {
    const family = familyFromStack(stack);
    const existing = byName.get(family);
    if (existing) {
      existing.roles.add(role);
      if (!existing.themes.includes(theme)) existing.themes.push(theme);
      return;
    }
    byName.set(family, {
      family,
      fontFamily: stack,
      roles: new Set([role]),
      themes: [theme],
      inSansPool: POOL_SANS_NAMES.has(family),
      inSerifPool: POOL_SERIF_NAMES.has(family),
      googleFontsUrl: FONT_IMPORTS[family] ?? null,
    });
  }

  for (const t of THEMES) {
    touch(t.display, 'display', t);
    touch(t.sub, 'sub', t);
    touch(t.mono, 'mono', t);
  }
  // Pool members that aren't currently used by any theme (e.g. Bebas Neue
  // sits in CAP_SANS_FONTS but no theme picks it) still belong in the
  // catalogue — they're available to the randomizer.
  for (const [stack, name] of CAP_SANS_FONTS) {
    if (!byName.has(name)) {
      byName.set(name, {
        family: name,
        fontFamily: stack,
        roles: new Set(['display']),
        themes: [],
        inSansPool: true,
        inSerifPool: false,
        googleFontsUrl: FONT_IMPORTS[name] ?? null,
      });
    }
  }
  for (const [stack, name] of CAP_SERIF_FONTS) {
    if (!byName.has(name)) {
      byName.set(name, {
        family: name,
        fontFamily: stack,
        roles: new Set(['display']),
        themes: [],
        inSansPool: false,
        inSerifPool: true,
        googleFontsUrl: FONT_IMPORTS[name] ?? null,
      });
    }
  }

  return [...byName.values()].sort((x, y) => {
    if (y.themes.length !== x.themes.length) {
      return y.themes.length - x.themes.length;
    }
    return x.family.localeCompare(y.family);
  });
}

function roleLabel(role: FontRole): string {
  return role === 'display' ? 'Display' : role === 'sub' ? 'Sub' : 'Mono';
}

// Heuristic category for the chip — based on where the family is actually used.
function categoryFor(card: FontCard): { label: string; tone: 'amber' | 'cyan' | 'muted' } {
  if (card.roles.has('mono')) return { label: 'Mono', tone: 'cyan' };
  if (card.roles.has('display')) return { label: 'Display', tone: 'amber' };
  return { label: 'Sub', tone: 'muted' };
}

// ─── Pairings (emergent triplets) ───────────────────────────────────────────

type Pairing = {
  pair: string;
  display: string;
  sub: string;
  mono: string;
  themes: LabTheme[];
};

function buildPairings(): Pairing[] {
  const byPair = new Map<string, Pairing>();
  for (const t of THEMES) {
    const existing = byPair.get(t.pair);
    if (existing) {
      existing.themes.push(t);
    } else {
      byPair.set(t.pair, {
        pair: t.pair,
        display: t.display,
        sub: t.sub,
        mono: t.mono,
        themes: [t],
      });
    }
  }
  return [...byPair.values()].sort((x, y) => {
    if (y.themes.length !== x.themes.length) {
      return y.themes.length - x.themes.length;
    }
    return x.pair.localeCompare(y.pair);
  });
}

// ─── Theme contrast ─────────────────────────────────────────────────────────

type AccentCheck = {
  key: 'c1' | 'c2' | 'c3' | 'c4';
  raw: string;
  ratio: number;
  adjusted: string | null;
  adjustedRatio: number | null;
  passes: boolean;
};

function checkTheme(t: LabTheme): AccentCheck[] {
  return (['c1', 'c2', 'c3', 'c4'] as const).map((k) => {
    const raw = t[k];
    const ratio = wcagContrast(raw, t.bg);
    if (ratio >= MIN_CONTRAST) {
      return { key: k, raw, ratio, adjusted: null, adjustedRatio: null, passes: true };
    }
    const adjusted = ensurePassing(raw, t.bg);
    const adjustedRatio = adjusted ? wcagContrast(adjusted, t.bg) : null;
    return {
      key: k,
      raw,
      ratio,
      adjusted: adjusted && adjusted !== raw ? adjusted : null,
      adjustedRatio,
      passes: false,
    };
  });
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function LabSystemPage() {
  useEffect(() => {
    loadCaptionFonts();
  }, []);

  const fonts = useMemo(buildFontCatalogue, []);
  const pairings = useMemo(buildPairings, []);

  return (
    <div className={`${a.page} ${a.wide}`}>
      <PageHeader
        eyebrow={
          <MonoLabel tone="cyan" dot>
            Caption Lab · Design System
          </MonoLabel>
        }
        title={<SerifDisplay size="xl">Caption tokens, in catalogue.</SerifDisplay>}
        description="Every font, theme, pairing, and motion the lab can generate from — a living maintenance view for designers. Edit the data files in web/src/pages/lab/data/ and this page reflects them."
        rightSlot={
          <Button as="a" href="/lab" variant="cyan" leadingIcon={<ArrowLeft size={13} />}>
            Back to Lab
          </Button>
        }
      />

      <div className={styles.stats}>
        <Pill tone="amber" dot>{THEMES.length} themes</Pill>
        <Pill tone="cyan" dot>{fonts.length} fonts</Pill>
        <Pill tone="good" dot>{pairings.length} pairings</Pill>
        <Pill tone="muted" dot>{WORD_FX.length} effects</Pill>
      </div>

      <nav className={styles.toc}>
        <a href="#fonts" className={styles.tocLink}>Fonts</a>
        <span className={styles.tocSep} aria-hidden="true">·</span>
        <a href="#themes" className={styles.tocLink}>Themes</a>
        <span className={styles.tocSep} aria-hidden="true">·</span>
        <a href="#pairings" className={styles.tocLink}>Pairings</a>
        <span className={styles.tocSep} aria-hidden="true">·</span>
        <a href="#effects" className={styles.tocLink}>Effects</a>
      </nav>

      <FontsSection fonts={fonts} />
      <ThemesSection />
      <PairingsSection pairings={pairings} />
      <EffectsSection />
    </div>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

function SectionHead({
  id,
  label,
  count,
  blurb,
}: {
  id: string;
  label: string;
  count: number;
  blurb: string;
}) {
  return (
    <div id={id} className={styles.sectionHead}>
      <div className={styles.sectionTitleRow}>
        <MonoLabel tone="bright">
          {label} · {count}
        </MonoLabel>
        <span className={styles.rule} aria-hidden="true" />
      </div>
      <p className={styles.sectionBlurb}>{blurb}</p>
    </div>
  );
}

function FontsSection({ fonts }: { fonts: FontCard[] }) {
  return (
    <section className={styles.section}>
      <SectionHead
        id="fonts"
        label="Fonts"
        count={fonts.length}
        blurb="Every family the lab can render — union of the randomizer pools and every typography slot across the 18 themes. Sorted by theme adoption."
      />
      <div className={styles.fontGrid}>
        {fonts.map((f) => (
          <FontCard key={f.family} font={f} />
        ))}
      </div>
    </section>
  );
}

function FontCard({ font }: { font: FontCard }) {
  const cat = categoryFor(font);
  return (
    <Card padding="none" className={styles.fontCard}>
      <div className={styles.fontSpecimen} style={{ fontFamily: font.fontFamily }}>
        <span className={styles.specRoman}>Aa</span>
        <span className={styles.specItalic}>Aa</span>
      </div>
      <div className={styles.fontBody}>
        <div className={styles.fontHead}>
          <SerifDisplay size="sm" as="h3" className={styles.fontName}>
            {font.family}
          </SerifDisplay>
          <Pill tone={cat.tone}>{cat.label}</Pill>
        </div>
        <p className={styles.fontSample} style={{ fontFamily: font.fontFamily }}>
          Wabisabi sets fire to the night.
        </p>
        <div className={styles.fontMeta}>
          <MonoLabel tone="dim">
            {font.themes.length} theme{font.themes.length === 1 ? '' : 's'} ·{' '}
            roles{' '}
            {[...font.roles].map(roleLabel).join(' / ') || '—'}
          </MonoLabel>
          {(font.inSansPool || font.inSerifPool) && (
            <MonoLabel tone="cyan">
              In {font.inSansPool ? 'sans' : 'serif'} pool
            </MonoLabel>
          )}
          {font.googleFontsUrl && (
            <a
              href={font.googleFontsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.fontLink}
            >
              Google Fonts ↗
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function ThemesSection() {
  return (
    <section className={styles.section}>
      <SectionHead
        id="themes"
        label="Themes"
        count={THEMES.length}
        blurb="Each theme bundles a 6-colour palette (bg + ink + 4 accents) with a typography triple. Accents auto-brighten via engine/contrast.ts if they don't pass 4.5:1 against the background."
      />
      <div className={styles.themeGrid}>
        {THEMES.map((t) => (
          <ThemeCard key={t.id} theme={t} />
        ))}
      </div>
    </section>
  );
}

function ThemeCard({ theme }: { theme: LabTheme }) {
  const accents = useMemo(() => checkTheme(theme), [theme]);
  return (
    <Card padding="none" className={styles.themeCard}>
      <div
        className={styles.themePreview}
        style={{ background: theme.bg, color: theme.ink }}
      >
        <span className={styles.themePreviewSub} style={{ fontFamily: theme.sub }}>
          {theme.name}
        </span>
        <span className={styles.themePreviewDisplay} style={{ fontFamily: theme.display }}>
          Wabi<span style={{ color: accents.find((a) => a.passes)?.adjusted ?? accents.find((a) => a.passes)?.raw ?? theme.c1 }}>sabi</span>
        </span>
        <span className={styles.themePreviewMono} style={{ fontFamily: theme.mono, color: theme.ink }}>
          {theme.id} · {theme.bg.toLowerCase()}
        </span>
      </div>

      <div className={styles.themeBody}>
        <div className={styles.themeHead}>
          <SerifDisplay size="sm" as="h3" className={styles.themeName}>
            {theme.name}
          </SerifDisplay>
          <MonoLabel tone="dim">{theme.id}</MonoLabel>
        </div>
        <p className={styles.themeNote}>{theme.note}</p>

        <div className={styles.swatchRow}>
          <Swatch label="bg" hex={theme.bg} />
          <Swatch label="ink" hex={theme.ink} />
          {(['c1', 'c2', 'c3', 'c4'] as const).map((k) => (
            <Swatch key={k} label={k} hex={theme[k]} />
          ))}
        </div>

        <div className={styles.contrastRow}>
          {accents.map((a) => (
            <ContrastBadge key={a.key} check={a} bg={theme.bg} />
          ))}
        </div>

        <div className={styles.tripleList}>
          <TripleRow role="DISPLAY" font={theme.display} />
          <TripleRow role="SUB" font={theme.sub} />
          <TripleRow role="MONO" font={theme.mono} />
        </div>
      </div>
    </Card>
  );
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  return (
    <div className={styles.swatch}>
      <span className={styles.swatchChip} style={{ background: hex }} aria-hidden="true" />
      <span className={styles.swatchLabel}>{label}</span>
      <span className={styles.swatchHex}>{hex.toLowerCase()}</span>
    </div>
  );
}

function ContrastBadge({ check, bg }: { check: AccentCheck; bg: string }) {
  const ratio = check.ratio.toFixed(2);
  if (check.passes) {
    return (
      <span className={`${styles.contrastBadge} ${styles.contrastPass}`}>
        <span className={styles.contrastDot} style={{ background: check.raw }} aria-hidden="true" />
        {check.key.toUpperCase()} {ratio}:1
      </span>
    );
  }
  return (
    <span className={`${styles.contrastBadge} ${styles.contrastAdjust}`} title={`raw ${ratio}:1 vs ${bg}`}>
      <span className={styles.contrastDot} style={{ background: check.adjusted ?? check.raw }} aria-hidden="true" />
      {check.key.toUpperCase()} {ratio}→{check.adjustedRatio ? check.adjustedRatio.toFixed(2) : '✗'}
    </span>
  );
}

function TripleRow({ role, font }: { role: string; font: string }) {
  return (
    <div className={styles.tripleRow}>
      <span className={styles.tripleRole}>{role}</span>
      <span className={styles.tripleFont} style={{ fontFamily: font }}>
        {familyFromStack(font)}
      </span>
    </div>
  );
}

function PairingsSection({ pairings }: { pairings: Pairing[] }) {
  return (
    <section className={styles.section}>
      <SectionHead
        id="pairings"
        label="Font pairings"
        count={pairings.length}
        blurb="Pairings aren't a separate token type — they emerge from theme triplets. Cards group themes by the (display × sub × mono) signature, ranked by adoption."
      />
      <div className={styles.pairingGrid}>
        {pairings.map((p) => (
          <PairingCard key={p.pair} pairing={p} />
        ))}
      </div>
    </section>
  );
}

function PairingCard({ pairing }: { pairing: Pairing }) {
  return (
    <Card padding="none" className={styles.pairingCard}>
      <div className={styles.pairingSpecimen}>
        <span className={styles.pairingDisplay} style={{ fontFamily: pairing.display }}>
          Headline
        </span>
        <span className={styles.pairingSub} style={{ fontFamily: pairing.sub }}>
          A second voice — the supporting line, set in the sub family. Looser, more legible at body sizes.
        </span>
        <span className={styles.pairingMono} style={{ fontFamily: pairing.mono }}>
          00:14 · {pairing.themes.length}× adopted
        </span>
      </div>
      <div className={styles.pairingBody}>
        <div className={styles.pairingMeta}>
          <MonoLabel tone="bright">{pairing.pair}</MonoLabel>
          <Pill tone={pairing.themes.length > 1 ? 'amber' : 'muted'}>
            {pairing.themes.length}×
          </Pill>
        </div>
        <div className={styles.pairingThemes}>
          {pairing.themes.map((t) => (
            <span key={t.id} className={styles.pairingThemeChip} title={t.note}>
              {t.name}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function EffectsSection() {
  return (
    <section className={styles.section}>
      <SectionHead
        id="effects"
        label="Effects"
        count={WORD_FX.length}
        blurb="Word-level entrance animations from animations.css. Previews loop the real keyframes — splitsLetters effects burst per-letter via the --letter-step variable."
      />
      <div className={styles.effectGrid}>
        {WORD_FX.map((fx) => (
          <EffectCard key={fx.id} fx={fx} />
        ))}
      </div>
    </section>
  );
}

function EffectCard({ fx }: { fx: (typeof WORD_FX)[number] }) {
  const word = 'WABISABI';
  return (
    <Card padding="none" className={styles.effectCard}>
      <div className={styles.effectStage}>
        <EffectLoop fxId={fx.id} word={word} splits={fx.splitsLetters} />
      </div>
      <div className={styles.effectBody}>
        <div className={styles.effectHead}>
          <SerifDisplay size="sm" as="h3" className={styles.effectName}>
            {fx.label}
          </SerifDisplay>
          <MonoLabel tone="dim">{fx.id}</MonoLabel>
        </div>
        <p className={styles.effectDesc}>{fx.description}</p>
        <dl className={styles.effectSpec}>
          <div><dt>scope</dt><dd>{fx.scope}</dd></div>
          <div><dt>duration</dt><dd>{fx.duration}</dd></div>
          <div><dt>easing</dt><dd className={styles.specMono}>{fx.easing}</dd></div>
          <div><dt>splits</dt><dd>{fx.splitsLetters ? 'letters' : 'word'}</dd></div>
          <div><dt>random</dt><dd>{fx.randomizable ? 'pool' : 'baked'}</dd></div>
        </dl>
      </div>
    </Card>
  );
}

// Replays the effect every ~2.8s by bumping a mount key. animations.css drives
// the actual motion — we only attach the .we-<id> class and split letters
// when required. The we-wobble effect already loops infinitely so we don't
// need to remount it.
function EffectLoop({
  fxId,
  word,
  splits,
}: {
  fxId: string;
  word: string;
  splits: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (fxId === 'we-wobble') return; // self-looping
    const t = window.setInterval(() => setTick((n) => n + 1), 2800);
    return () => window.clearInterval(t);
  }, [fxId]);

  const letterStyle = (j: number): React.CSSProperties =>
    ({ ['--j' as string]: j } as React.CSSProperties);
  const wordStyle: React.CSSProperties = {
    ['--i' as string]: 0,
    ['--letter-step' as string]: '36ms',
    ['--word-step' as string]: '0s',
  } as React.CSSProperties;

  return (
    <div className={`lab-caption ${styles.effectCaption}`}>
      <div className="caption">
        <span key={tick} className={`w ${fxId}`} style={wordStyle}>
          {splits
            ? [...word].map((ch, j) => (
                <span key={j} className="lt" data-m={j % 4} style={letterStyle(j)}>
                  {ch}
                </span>
              ))
            : word}
        </span>
      </div>
    </div>
  );
}
