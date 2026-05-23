// Caption font pools + one-shot Google Fonts / Fontshare loader.
//
// The lab loads its own font sheet (separate from web/src/lib/preloadFonts.ts
// which feeds the Remotion compositions) because several caption families
// the HTML uses — Bodoni Moda, Big Shoulders Display, Syncopate, Tenor Sans,
// IBM Plex Mono, Spline Sans Mono, Sora, Familjen Grotesk, etc — aren't
// pulled in by the Remotion preloader. Rather than fragment them across
// individual @remotion/google-fonts imports, we mirror the HTML's approach:
// one <link> injection at lab-page mount, the browser dedupes.
//
// To add a caption font: append the family name to CAP_SANS_FONTS or
// CAP_SERIF_FONTS AND make sure it appears in CAPTION_FONTS_HREF below.
// (If it's already in a loaded Google Fonts URL no further work needed.)

// Verbatim from ae-packs-player.html <style>@import — covers every theme
// `display`/`sub`/`mono` stack PLUS the CAP_SANS_FONTS / CAP_SERIF_FONTS pools.
export const CAPTION_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  'family=Albert+Sans:wght@400;700;900' +
  '&family=Alfa+Slab+One' +
  '&family=Anton' +
  '&family=Archivo+Black' +
  '&family=Archivo:wght@400;600;800' +
  '&family=Bagel+Fat+One' +
  '&family=Barlow:wght@400;700' +
  '&family=Barlow+Condensed:wght@700;800' +
  '&family=Bebas+Neue' +
  '&family=Big+Shoulders+Display:wght@700;900' +
  '&family=Bodoni+Moda:ital,wght@0,700;0,900;1,700' +
  '&family=Bowlby+One' +
  '&family=Bricolage+Grotesque:wght@400;700;800' +
  '&family=Caprasimo' +
  '&family=Crimson+Pro:wght@500;700' +
  '&family=DM+Serif+Display:ital@0;1' +
  '&family=Familjen+Grotesk:wght@400;700' +
  '&family=Fraunces:opsz,wght@9..144,500;9..144,900' +
  '&family=IBM+Plex+Mono:wght@400;700' +
  '&family=Instrument+Serif:ital@0;1' +
  '&family=Inter:wght@400;700;900' +
  '&family=JetBrains+Mono:wght@400;700' +
  '&family=Jost:wght@400;700;800' +
  '&family=Manrope:wght@400;700;800' +
  '&family=Outfit:wght@400;700;900' +
  '&family=Playfair+Display:ital,wght@0,700;0,900;1,700' +
  '&family=Public+Sans:wght@400;700;900' +
  '&family=Sora:wght@300;500;700;800' +
  '&family=Space+Grotesk:wght@400;500;700' +
  '&family=Space+Mono:wght@400;700' +
  '&family=Spline+Sans+Mono:wght@400;700' +
  '&family=Syncopate:wght@400;700' +
  '&family=Tenor+Sans' +
  '&family=Urbanist:wght@400;700;900' +
  '&family=Zilla+Slab:wght@400;700' +
  '&display=swap';

// Fontshare hosts General Sans and Gambarino — both free for commercial use.
// Loaded separately because Fontshare uses its own API surface.
export const FONTSHARE_FONTS_HREF =
  'https://api.fontshare.com/v2/css?' +
  'f[]=general-sans@500,700,800' +
  '&f[]=gambarino@400' +
  '&display=swap';

// Caption body-sans pool. Originally heavy display grotesks; the lower group
// (Inter onward) is grown out from a 6-pair brief that asked for cleaner
// workhorse sans alongside expressive display fonts. Most ship from Google
// Fonts; General Sans is from Fontshare and loaded via FONTSHARE_FONTS_HREF.
export const CAP_SANS_FONTS: ReadonlyArray<readonly [string, string]> = [
  [`'Anton',sans-serif`, 'Anton'],
  [`'Archivo Black',sans-serif`, 'Archivo Black'],
  [`'Big Shoulders Display',sans-serif`, 'Big Shoulders Display'],
  [`'Bebas Neue',sans-serif`, 'Bebas Neue'],
  [`'Syncopate',sans-serif`, 'Syncopate'],
  [`'Bricolage Grotesque',sans-serif`, 'Bricolage Grotesque'],
  // ── Newer additions (cleaner workhorses for body) ─────────────────────
  [`'Inter',sans-serif`, 'Inter'],
  [`'Jost',sans-serif`, 'Jost'],
  [`'Manrope',sans-serif`, 'Manrope'],
  [`'Public Sans',sans-serif`, 'Public Sans'],
  [`'Barlow Condensed',sans-serif`, 'Barlow Condensed'],
  [`'General Sans',sans-serif`, 'General Sans'],
];

// Caption emphasis/display pool. The role classes apply italic via CSS, so
// fonts without a real italic file get synthesized italic — fine for the
// display serifs at the top, acceptable on the chunky display fonts at the
// bottom which lean on weight/scale instead of slant for emphasis.
export const CAP_SERIF_FONTS: ReadonlyArray<readonly [string, string]> = [
  [`'Fraunces',Georgia,serif`, 'Fraunces'],
  [`'Playfair Display',Georgia,serif`, 'Playfair Display'],
  [`'Bodoni Moda',Georgia,serif`, 'Bodoni Moda'],
  [`'DM Serif Display',Georgia,serif`, 'DM Serif Display'],
  [`'Instrument Serif',Georgia,serif`, 'Instrument Serif'],
  // ── Newer additions (chunky / expressive display) ─────────────────────
  [`'Bagel Fat One',cursive`, 'Bagel Fat One'],
  [`'Alfa Slab One',serif`, 'Alfa Slab One'],
  [`'Bowlby One',sans-serif`, 'Bowlby One'],
  [`'Caprasimo',serif`, 'Caprasimo'],
  [`'Gambarino',serif`, 'Gambarino'],
];

// Per-family Google Fonts URLs — included in the JSON preset so an exported
// composition can be reconstructed in a different project with paste-in links.
export const FONT_IMPORTS: Record<string, string> = {
  Anton: 'https://fonts.googleapis.com/css2?family=Anton&display=swap',
  'Archivo Black':
    'https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap',
  'Big Shoulders Display':
    'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&display=swap',
  'Bebas Neue':
    'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
  Syncopate:
    'https://fonts.googleapis.com/css2?family=Syncopate:wght@700&display=swap',
  'Bricolage Grotesque':
    'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&display=swap',
  Fraunces:
    'https://fonts.googleapis.com/css2?family=Fraunces:wght@900&display=swap',
  'Playfair Display':
    'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&display=swap',
  'Bodoni Moda':
    'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@1,700&display=swap',
  'DM Serif Display':
    'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@1&display=swap',
  'Instrument Serif':
    'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&display=swap',
  // ── Newer additions ───────────────────────────────────────────────────
  Inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap',
  Jost: 'https://fonts.googleapis.com/css2?family=Jost:wght@800&display=swap',
  Manrope:
    'https://fonts.googleapis.com/css2?family=Manrope:wght@800&display=swap',
  'Public Sans':
    'https://fonts.googleapis.com/css2?family=Public+Sans:wght@900&display=swap',
  'Barlow Condensed':
    'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800&display=swap',
  'General Sans':
    'https://api.fontshare.com/v2/css?f[]=general-sans@800&display=swap',
  'Bagel Fat One':
    'https://fonts.googleapis.com/css2?family=Bagel+Fat+One&display=swap',
  'Alfa Slab One':
    'https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap',
  'Bowlby One':
    'https://fonts.googleapis.com/css2?family=Bowlby+One&display=swap',
  Caprasimo:
    'https://fonts.googleapis.com/css2?family=Caprasimo&display=swap',
  Gambarino:
    'https://api.fontshare.com/v2/css?f[]=gambarino@400&display=swap',
};

const GOOGLE_LINK_ID = 'lab-caption-fonts';
const FONTSHARE_LINK_ID = 'lab-caption-fonts-fontshare';

function injectStylesheet(id: string, href: string) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// Inject the caption-fonts <link>s once per session — Google Fonts for the
// bulk of the catalogue, Fontshare for General Sans + Gambarino. Safe to
// call repeatedly; the browser dedupes the network request anyway but we
// also skip the DOM mutation.
export function loadCaptionFonts() {
  if (typeof document === 'undefined') return;
  injectStylesheet(GOOGLE_LINK_ID, CAPTION_FONTS_HREF);
  injectStylesheet(FONTSHARE_LINK_ID, FONTSHARE_FONTS_HREF);
}

// Curated sans + serif pairings. Each pair is designed so the two families
// read as a deliberate set (contrast in weight, era, or geometry), not a
// random combination. Random rolls pick from this list; the Properties
// panel offers them as a single selectable unit.
export type FontPairing = {
  id: string;
  name: string;
  // Tuples are [stack, family] — same shape as CAP_SANS_FONTS / CAP_SERIF_FONTS
  // so consumers can read the stack into --cap-sans / --cap-serif.
  sans: readonly [string, string];
  serif: readonly [string, string];
};

const sans = (family: string) =>
  CAP_SANS_FONTS.find((f) => f[1] === family) ?? CAP_SANS_FONTS[0];
const serif = (family: string) =>
  CAP_SERIF_FONTS.find((f) => f[1] === family) ?? CAP_SERIF_FONTS[0];

export const FONT_PAIRINGS: ReadonlyArray<FontPairing> = [
  {
    id: 'editorial',
    name: 'Editorial',
    sans: sans('Archivo Black'),
    serif: serif('Playfair Display'),
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    sans: sans('Syncopate'),
    serif: serif('Bodoni Moda'),
  },
  {
    id: 'vintage',
    name: 'Vintage',
    sans: sans('Anton'),
    serif: serif('Fraunces'),
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    sans: sans('Bebas Neue'),
    serif: serif('DM Serif Display'),
  },
  {
    id: 'modern',
    name: 'Modern',
    sans: sans('Bricolage Grotesque'),
    serif: serif('Instrument Serif'),
  },
  {
    id: 'athletic',
    name: 'Athletic',
    sans: sans('Big Shoulders Display'),
    serif: serif('Fraunces'),
  },
  // ── Pairings from the 6-pair brief. Where the original font was
  //    commercial-only (Recoleta, Proxima Nova Condensed, ITC Avant Garde,
  //    Cooper BT, Berthold, Sailors, Tempting, Peace Sans, Open Sauce) the
  //    closest free equivalent is used and noted in the pairing comment.
  {
    id: 'saucy',
    name: 'Saucy', // ≈ "Open Sauce + Peace Sans" — Open Sauce → Public Sans, Peace Sans → Bowlby One
    sans: sans('Public Sans'),
    serif: serif('Bowlby One'),
  },
  {
    id: 'high-contrast',
    name: 'High Contrast', // ≈ "Inter + Tempting" — Tempting → DM Serif Display
    sans: sans('Inter'),
    serif: serif('DM Serif Display'),
  },
  {
    id: 'warm',
    name: 'Warm', // ≈ "Recoleta + Berthold" — Recoleta → Manrope, Berthold → Alfa Slab One
    sans: sans('Manrope'),
    serif: serif('Alfa Slab One'),
  },
  {
    id: 'sailing',
    name: 'Sailing', // ≈ "Proxima Nova Condensed + Sailors" — both → free condensed + chunky
    sans: sans('Barlow Condensed'),
    serif: serif('Bagel Fat One'),
  },
  {
    id: 'geo',
    name: 'Geo', // ≈ "ITC Avant Garde + Cooper BT" — Avant Garde → Jost, Cooper BT → Caprasimo
    sans: sans('Jost'),
    serif: serif('Caprasimo'),
  },
  {
    id: 'refined',
    name: 'Refined', // = "General Sans + Editorial New" — Editorial New → Gambarino (free Fontshare)
    sans: sans('General Sans'),
    serif: serif('Gambarino'),
  },
];

export const PAIRING_BY_ID: Record<string, FontPairing> = Object.fromEntries(
  FONT_PAIRINGS.map((p) => [p.id, p]),
);

export function randomPairing(): FontPairing {
  return FONT_PAIRINGS[Math.floor(Math.random() * FONT_PAIRINGS.length)];
}

// Best-effort reverse lookup: given a sans + serif family, find a pairing
// whose two halves match. Used when a roll predates the pairing system or
// the user manually constructs a non-curated combo via JSON.
export function pairingForFamilies(
  sansFamily: string,
  serifFamily: string,
): FontPairing | null {
  return (
    FONT_PAIRINGS.find(
      (p) => p.sans[1] === sansFamily && p.serif[1] === serifFamily,
    ) ?? null
  );
}
