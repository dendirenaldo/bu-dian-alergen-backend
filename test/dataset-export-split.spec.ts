/**
 * Unit: split berkonfigurasi (seed, rasio, sadar-grup, stratifikasi multilabel).
 */
import { buildConfiguredSplit, textHash } from '../src/modules/dataset/dataset.split';

function row(id: number, detectionId: number | null, text: string, labels: string[]) {
  return {
    id,
    groupKey: detectionId != null ? `d:${detectionId}` : `i:${id}`,
    textHash: textHash(text),
    labels,
  };
}

describe('buildConfiguredSplit', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    row(i + 1, Math.floor(i / 2), `produk ${i + 1} mengandung susu`, [
      i % 3 === 0 ? 'safe' : 'unsafe',
      i % 4 === 0 ? 'allergen_susu' : 'allergen_gluten',
    ]),
  );

  test('deterministik untuk seed yang sama', () => {
    const a = buildConfiguredSplit(rows, { seed: 7 });
    const b = buildConfiguredSplit(rows, { seed: 7 });
    expect(a.splits).toEqual(b.splits);
    expect(a.audit).toEqual(b.audit);
  });

  test('seed berbeda mengubah pembagian', () => {
    const a = buildConfiguredSplit(rows, { seed: 1 });
    const b = buildConfiguredSplit(rows, { seed: 2 });
    expect(JSON.stringify(a.splits)).not.toBe(JSON.stringify(b.splits));
  });

  test('tidak ada record di dua split dan audit PASS', () => {
    const r = buildConfiguredSplit(rows, { seed: 42, ratios: { train: 0.7, validation: 0.15, test: 0.15 } });
    const all = [...r.splits.train, ...r.splits.validation, ...r.splits.test];
    expect(new Set(all).size).toBe(rows.length);
    expect(r.audit.every((a) => a.status === 'PASS')).toBe(true);
    expect(r.counts.total).toBe(rows.length);
  });

  test('grup deteksi tidak terpecah antar split', () => {
    const r = buildConfiguredSplit(rows, { seed: 42, groupBy: 'detection' });
    const splitOf = new Map<number, string>();
    (['train', 'validation', 'test'] as const).forEach((s) =>
      r.splits[s].forEach((id) => splitOf.set(id, s)),
    );
    // detection 0 = record 1 & 2
    expect(splitOf.get(1)).toBe(splitOf.get(2));
  });

  test('rasio kustom dihormati secara aproksimatif', () => {
    const r = buildConfiguredSplit(rows, { seed: 42, ratios: { train: 0.5, validation: 0.25, test: 0.25 } });
    expect(r.ratios).toEqual({ train: 0.5, validation: 0.25, test: 0.25 });
    expect(r.counts.validation + r.counts.test).toBeGreaterThan(0);
  });

  test('distribusi label dilaporkan per split', () => {
    const r = buildConfiguredSplit(rows, { seed: 42 });
    expect(r.labelDistribution.safe).toBeDefined();
    expect(r.labelDistribution.allergen_susu.train + r.labelDistribution.allergen_susu.validation + r.labelDistribution.allergen_susu.test).toBeGreaterThan(0);
  });

  test('dataset kecil 3 grup tetap mengisi train/validation/test', () => {
    const small = [row(1, 1, 'a', ['safe']), row(2, 2, 'b', ['unsafe']), row(3, 3, 'c', ['safe'])];
    const r = buildConfiguredSplit(small, { seed: 42 });
    expect(r.counts.train).toBeGreaterThan(0);
    expect(r.counts.validation).toBeGreaterThan(0);
    expect(r.counts.test).toBeGreaterThan(0);
    expect(r.audit.every((a) => a.status === 'PASS')).toBe(true);
  });

  test('dataset 2 grup memberi peringatan split kosong yang eksplisit', () => {
    const small = [row(1, 1, 'a', ['safe']), row(2, 2, 'b', ['unsafe'])];
    const r = buildConfiguredSplit(small, { seed: 42 });
    expect(r.warning).toBeTruthy();
    expect(r.counts.total).toBe(2);
  });

  test('duplikat teks disatukan ke komponen yang sama', () => {
    const dup = [row(1, 1, 'susu bubuk', ['unsafe']), row(2, 2, 'susu bubuk', ['unsafe'])];
    const r = buildConfiguredSplit(dup, { seed: 42 });
    const splitOf = new Map<number, string>();
    (['train', 'validation', 'test'] as const).forEach((s) =>
      r.splits[s].forEach((id) => splitOf.set(id, s)),
    );
    expect(splitOf.get(1)).toBe(splitOf.get(2));
    expect(r.duplicateGroupCount).toBe(1);
  });
});
