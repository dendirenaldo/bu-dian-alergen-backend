/**
 * Sortir kolom untuk endpoint list (anti-injeksi kolom).
 *
 * `allowed` memetakan kunci UI (query `sortBy`) ke kolom DB yang aman.
 * Kunci tak-terdaftar → fallback (order lama), TIDAK pernah 500.
 * `sortDir` selain 'asc' → 'DESC'.
 */
export type SortDir = 'ASC' | 'DESC';

export function buildOrder(
  sortBy: unknown,
  sortDir: unknown,
  allowed: Record<string, string>,
  fallback: Array<[string, SortDir]>,
): Array<[string, SortDir]> {
  const col = typeof sortBy === 'string' ? allowed[sortBy] : undefined;
  if (!col) return fallback;
  const dir: SortDir = String(sortDir ?? '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return [[col, dir]];
}
