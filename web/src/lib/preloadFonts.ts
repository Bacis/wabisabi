// Preload Google Fonts for the web editor's Player. Each loadFont call
// injects a <link rel="stylesheet"> with the @font-face declarations; the
// browser fetches the actual binary fonts on first render. By calling these
// at module init we ensure that any font name the user picks in the form
// can render in the Player without a flash of fallback type.
//
// Templates also import their own font (e.g. ReelClone → Inter, Carnival →
// Workbench); those self-loads happen at template module import time and
// are duplicated by these calls but the loader is idempotent — calling
// loadFont('normal', { weights: ['400'], subsets: ['latin'] }) twice with
// the same args is a no-op.
//
// Adding a font:
//   1. Verify node_modules/@remotion/google-fonts/dist/esm/<Name>.mjs exists.
//   2. Add the loadFont() call here.
//   3. (Optional) Reference the family name from a `font/*` pack in
//      src/shared/pipeline/packs/index.ts so the agent can reach it via
//      apply_preset_pack(font, …).

import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadPlusJakarta } from '@remotion/google-fonts/PlusJakartaSans';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadLobster } from '@remotion/google-fonts/Lobster';
import { loadFont as loadWorkbench } from '@remotion/google-fonts/Workbench';

// 10 new fonts spanning display, cinematic-serif, retro, mono, hand-drawn:
import { loadFont as loadBebas } from '@remotion/google-fonts/BebasNeue';
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { loadFont as loadAbril } from '@remotion/google-fonts/AbrilFatface';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';
import { loadFont as loadCormorant } from '@remotion/google-fonts/CormorantGaramond';
import { loadFont as loadPressStart } from '@remotion/google-fonts/PressStart2P';
import { loadFont as loadVT323 } from '@remotion/google-fonts/VT323';
import { loadFont as loadPacifico } from '@remotion/google-fonts/Pacifico';
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadPermanentMarker } from '@remotion/google-fonts/PermanentMarker';
import { loadFont as loadDMSans } from '@remotion/google-fonts/DMSans';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadArchivoBlack } from '@remotion/google-fonts/ArchivoBlack';

// Atelier UI shell fonts. Referenced in atelier.module.css + AgentChatPane:
//   --ag-font-serif: 'Instrument Serif' — italic display headlines
//   --ag-font-display: 'Onest' — currently unused but reserved
// Without these the cinematic headings flash to the Lora/Inter fallback.
import { loadFont as loadInstrumentSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadOnest } from '@remotion/google-fonts/Onest';

// 2026-trending picks sourced from Typewolf + Creative Boom + caption-font
// roundups. Each adds a distinct headline vibe the agent's font slot can now
// reach via apply_preset_pack(font, …) — without these the agent falls back
// to interBlack/impactBold and every clip ends up looking the same.
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadBricolage } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadUnbounded } from '@remotion/google-fonts/Unbounded';
import { loadFont as loadHanken } from '@remotion/google-fonts/HankenGrotesk';
import { loadFont as loadRecursive } from '@remotion/google-fonts/Recursive';
import { loadFont as loadInstrumentSans } from '@remotion/google-fonts/InstrumentSans';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';

// Standard subset for all caption use cases. Adding 'symbols' / 'math' would
// double network requests for fonts the user is unlikely to need in lyrics.
const SUBSETS = ['latin'] as const;

// Existing template fonts — load with their full weight ranges so any
// preset that touches them keeps rendering identically.
loadInter('normal', { weights: ['400', '700', '800', '900'], subsets: SUBSETS as any });
loadInter('italic', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadPlusJakarta('normal', { weights: ['400', '700', '800'], subsets: SUBSETS as any });
loadPlayfair('normal', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadPlayfair('italic', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadLobster('normal', { weights: ['400'], subsets: SUBSETS as any });
loadWorkbench('normal', { weights: ['400'], subsets: SUBSETS as any });

// New fonts. Single-weight display fonts only have '400'; serifs/mono fonts
// load 400 + 700 so the form's Weight slider can target a meaningful range.
loadBebas('normal', { weights: ['400'], subsets: SUBSETS as any });
loadAnton('normal', { weights: ['400'], subsets: SUBSETS as any });
loadAbril('normal', { weights: ['400'], subsets: SUBSETS as any });
loadCinzel('normal', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadCormorant('normal', { weights: ['400', '700'], subsets: SUBSETS as any });
loadCormorant('italic', { weights: ['400', '700'], subsets: SUBSETS as any });
loadPressStart('normal', { weights: ['400'], subsets: SUBSETS as any });
loadVT323('normal', { weights: ['400'], subsets: SUBSETS as any });
loadPacifico('normal', { weights: ['400'], subsets: SUBSETS as any });
loadJetBrainsMono('normal', { weights: ['400', '700'], subsets: SUBSETS as any });
loadPermanentMarker('normal', { weights: ['400'], subsets: SUBSETS as any });
loadDMSans('normal', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadOutfit('normal', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadArchivoBlack('normal', { weights: ['400'], subsets: SUBSETS as any });

// UI shell — italic display + sans companion.
loadInstrumentSerif('normal', { weights: ['400'], subsets: SUBSETS as any });
loadInstrumentSerif('italic', { weights: ['400'], subsets: SUBSETS as any });
loadOnest('normal', { weights: ['400', '500', '700'], subsets: SUBSETS as any });

// 2026-trending caption picks — match the font.* packs in
// src/shared/pipeline/packs/index.ts. Weight ranges follow the same rule as
// above: single-axis display fonts get '400' only; text/variable families
// load 400 + 700 + 800/900 so the agent's weight slider can target meaningful
// emphasis steps without re-fetching.
loadFraunces('normal', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadBricolage('normal', { weights: ['400', '700', '800'], subsets: SUBSETS as any });
loadSpaceGrotesk('normal', { weights: ['400', '700'], subsets: SUBSETS as any });
loadUnbounded('normal', { weights: ['400', '700', '800'], subsets: SUBSETS as any });
loadHanken('normal', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadRecursive('normal', { weights: ['400', '700', '900'], subsets: SUBSETS as any });
loadInstrumentSans('normal', { weights: ['400', '700'], subsets: SUBSETS as any });
loadMontserrat('normal', { weights: ['400', '700', '800', '900'], subsets: SUBSETS as any });
loadPoppins('normal', { weights: ['400', '700', '800', '900'], subsets: SUBSETS as any });
