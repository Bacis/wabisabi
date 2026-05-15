// Curated showcase entries for the Library page.
// This is a hand-curated gallery of example renders + prompts (not the user's
// own jobs). Visitors copy the prompt to remix on their own clips.
// Edit this file to add/remove showcase items.

export type CuratedRenderPalette =
  | 'amber'
  | 'cool'
  | 'pop'
  | 'violet'
  | 'mint';

export type CuratedRenderStatus = 'done' | 'processing' | 'queued' | 'failed';

export type CuratedRenderGroup =
  | 'TODAY'
  | 'EARLIER THIS WEEK'
  | 'EARLIER THIS MONTH';

export type CuratedRender = {
  id: string;
  title: string;
  versionTag?: string;
  clipLine: string;
  palette: CuratedRenderPalette;
  capA: string;
  capB: string;
  status: CuratedRenderStatus;
  format: string;
  duration: string;
  when: string;
  group: CuratedRenderGroup;
  outputUrl?: string;
  prompt: string;
  errorMessage?: string;
  errorMeta?: string;
  progressPct?: number;
  queuePosition?: number;
};

export const CURATED_RENDERS: CuratedRender[] = [];
