// Tiny dot-path get/set utilities for the styleSpec object. We deliberately
// don't pull lodash for this — three lines each.

export function getPath(obj: any, path: string): any {
  if (!path) return obj;
  return path.split('.').reduce<any>((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}

export function setPath<T extends Record<string, any>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  if (!path) return value as T;
  const keys = path.split('.');
  const next: any = Array.isArray(obj) ? obj.slice() : { ...obj };
  let cursor = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const existing = cursor[k];
    cursor[k] = existing && typeof existing === 'object' ? { ...existing } : {};
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]!] = value;
  return next;
}

// Remove a key at the given dot-path. Used when toggling optional fields off.
export function unsetPath<T extends Record<string, any>>(obj: T, path: string): T {
  if (!path) return {} as T;
  const keys = path.split('.');
  const next: any = { ...obj };
  let cursor = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const existing = cursor[k];
    if (existing == null || typeof existing !== 'object') return obj;
    cursor[k] = { ...existing };
    cursor = cursor[k];
  }
  delete cursor[keys[keys.length - 1]!];
  return next;
}
