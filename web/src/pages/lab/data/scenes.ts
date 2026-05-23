// 10 caption scenes — each is one sentence with a designated PUNCH word
// (the oversized hero), a duration, and an optional baked-in word fx.
//
// To add a scene: append below. The lab picker and randomizer pick it up
// automatically. `fx: null` means "let the user / randomizer pick" — i.e.,
// no scene-baked effect.
//
// Ported from ae-packs-player.html (CAPTIONS array, line 1559).
//
// TODO(future): expose a "Generate scene from text" action that pipes raw
// transcript through Atelier to auto-pick punch index, duration, and a
// baked fx that matches the tone. Cache the agent's output as a LabScene
// so the Roll UX stays instant. (See chat 2026-05-23.)

import type { WordFxId } from './effects';

export type LabScene = {
  id: string;
  name: string;
  text: string;
  // Word index (0-based) that gets the massive PUNCH treatment.
  punch: number;
  // Scene duration in seconds.
  dur: number;
  // Baked-in word effect, or null to let the randomizer/user choose.
  fx: WordFxId | null;
  note: string;
};

export const SCENES: readonly LabScene[] = [
  // PLAIN: word-level reveal, no Letter Lab effects — role shuffle only.
  {
    id: '01',
    name: 'NCR METHOD',
    text: 'esse vídeo foi 100% feito usando um método chamado NCR e um celular',
    punch: 9,
    dur: 6.5,
    fx: null,
    note: 'pt-BR · midtrack.co reference reel · word-level reveal',
  },
  {
    id: '02',
    name: 'FUTURE OF CONTENT',
    text: 'this is the future of content creation right here right now',
    punch: 3,
    dur: 5.5,
    fx: null,
    note: 'en · short-form hook opener',
  },
  {
    id: '03',
    name: 'JUST A PHONE',
    text: 'I built my entire business using nothing but AI and a phone',
    punch: 11,
    dur: 6.2,
    fx: null,
    note: 'en · founder confession beat',
  },
  {
    id: '04',
    name: 'CONSISTENCY',
    text: 'the only thing you actually need to succeed is total consistency',
    punch: 10,
    dur: 6.0,
    fx: null,
    note: 'en · motivational sting',
  },
  {
    id: '05',
    name: 'STOP SCROLLING',
    text: 'stop scrolling and watch this one will change your entire week',
    punch: 1,
    dur: 5.8,
    fx: null,
    note: 'en · pattern-interrupt hook · punch lands EARLY',
  },
  {
    id: '06',
    name: 'IF YOU KNEW',
    text: 'if you knew what was coming next you would already be ready',
    punch: 5,
    dur: 6.0,
    fx: null,
    note: 'en · curiosity-gap hook · punch mid-sentence',
  },
  // LETTER LAB demos: each scene applies ONE effect across all words.
  {
    id: '07',
    name: 'CHANGES EVERYTHING',
    text: 'this changes everything you thought you knew about content',
    punch: 2,
    dur: 6.5,
    fx: 'we-stair',
    note: 'demo · L1 staircase reveal — every letter overshoots into place',
  },
  {
    id: '08',
    name: 'PLOT TWIST',
    text: "you won't believe what happened next on this random tuesday",
    punch: 2,
    dur: 6.8,
    fx: 'we-varied',
    note: 'demo · L2 varied mechanics — drop / blur / flip / slide cycled per letter',
  },
  {
    id: '09',
    name: 'THE TRUTH',
    text: 'the truth nobody talks about in the creator economy is this',
    punch: 1,
    dur: 6.5,
    fx: 'we-color',
    note: 'demo · L3 early-late color — letters enter accent, settle to role color',
  },
  {
    id: '10',
    name: 'IN MY PAJAMAS',
    text: 'I made this whole thing in my pajamas with one cup of coffee',
    punch: 7,
    dur: 6.5,
    fx: 'we-wobble',
    note: 'demo · L4 stepped wobble — letters never settle (indie-doc feel)',
  },
];
