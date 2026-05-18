// Starter clips offered on the Start page composer.
//
// Two variants:
//   - 'stock'  — a curated stock clip; the composer passes its id as
//                sourceId when minting a designer session.
//   - 'upload' — a persistent user_video the user just uploaded (or picked
//                from /library). The composer creates a job from the upload
//                on submit and proceeds as if it were a 'job'-kind starter.

export type StockStarter = {
  id: string;
  sourceKind: 'stock';
  filename: string;
  durationSec: number;
  aspect: '9:16' | '1:1' | '16:9';
  thumbColor?: string;
  description?: string;
};

export type UploadStarter = {
  id: string;            // userVideoId
  sourceKind: 'upload';
  filename: string;      // displayName (or originalFilename)
  durationSec: number;
  aspect: '9:16' | '1:1' | '16:9';
};

export type CuratedStarter = StockStarter | UploadStarter;

export const CURATED_STARTERS: StockStarter[] = [];

export const DEFAULT_STARTER: StockStarter | null =
  CURATED_STARTERS[0] ?? null;
