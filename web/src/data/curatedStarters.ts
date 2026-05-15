// Curated starter clips offered on the Start page.
// Edit this file to add/remove starter clips. Each entry must reference an
// existing stock clip id (sourceKind === 'stock' for now); the Start composer
// passes this directly as sourceId when minting a designer session.

export type CuratedStarter = {
  id: string;
  sourceKind: 'stock';
  filename: string;
  durationSec: number;
  aspect: '9:16' | '1:1' | '16:9';
  thumbColor?: string;
  description?: string;
};

export const CURATED_STARTERS: CuratedStarter[] = [];

export const DEFAULT_STARTER: CuratedStarter | null =
  CURATED_STARTERS[0] ?? null;
