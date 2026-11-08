/**
 * Normalisasi kolom JSON untuk MariaDB.
 *
 * MariaDB menyimpan `DataType.JSON` sebagai LONGTEXT (alias TEXT) sehingga
 * nilai dapat kembali sebagai **string** (bukan objek/array), tergantung
 * driver/dialek. Helper ini membuat pembacaan defensif: objek/array
 * diteruskan apa adanya, string di-`JSON.parse` secara aman, sisanya
 * diganti fallback. Dipakai di getter model + titik baca manual.
 */
export function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== 'string') return raw as T;
  const s = raw.trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Array defensif: kembalikan array bila array, parse bila string, selain itu fallback. */
export function parseJsonArray<T = unknown>(raw: unknown, fallback: T[] = []): T[] {
  const v = parseJsonField<unknown>(raw, fallback);
  return Array.isArray(v) ? (v as T[]) : fallback;
}

/** Objek defensif: kembalikan objek bila objek (bukan array), parse bila string, selain itu fallback. */
export function parseJsonObject<T extends Record<string, any> = Record<string, any>>(
  raw: unknown,
  fallback: T = {} as T,
): T {
  const v = parseJsonField<unknown>(raw, fallback);
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as T;
  return fallback;
}
