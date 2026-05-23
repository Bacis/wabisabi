// Shared selection type. Null means nothing's selected and Moveable is hidden.

export type Selection =
  | { kind: 'block' }
  | { kind: 'word'; idx: number }
  | null;
