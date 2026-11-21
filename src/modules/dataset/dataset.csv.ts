/** Escape CSV: gandakan " lalu bungkus bila mengandung , " CR LF. */
export function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function labelToId(label: string): number {
  return label === 'unsafe' ? 1 : 0;
}

/** Baris CSV dari array nilai (escape tiap sel). */
export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(',');
}
