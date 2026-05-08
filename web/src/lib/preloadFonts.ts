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
// Adding a font to the picker:
//   1. Verify @remotion/google-fonts/<Name> exists.
//   2. Add the loadFont() call here.
//   3. Add the family-name string to FontFamily.tsx's FONTS list.

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
