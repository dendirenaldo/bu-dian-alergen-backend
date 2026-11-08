/**
 * Unit: split anti-leakage modul dataset (port leakage_split V5, skala kecil).
 * - Deterministik seed 42, rasio 70/15/15 per komponen.
 * - 1 deteksi = 1 split; teks duplikat lintas deteksi = 1 split (union-find).
 * - Audit disjoint grup + exact-text PASS; duplicateGroups cap 50.
 */
import {
  LeakageDSU,
  auditSplitDisjoint,
  normalizeSplitText,
  seededShuffle,
  DatasetService,
} from '../src/modules/dataset/dataset.service';

function item(id: number, detectionId: number | null, text: string, goldLabel = 'safe'): any {
  return {
    id,
    detectionId,
    detection_id: detectionId,
    ocrText: text,
    ocr_text: text,
    correctedText: null,
    goldLabel,
    gold_label: goldLabel,
    status: 'verified',
  };
}

function service(): DatasetService {
  return new DatasetService(null as any, null as any, null as any, null as any, undefined);
}

describe('split anti-leakage dataset', () => {
  test('seededShuffle deterministik dan tidak mutasi input', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = seededShuffle(src, 42);
    const b = seededShuffle(src, 42);
    expect(a).toEqual(b);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('normalisasi konsisten (lowercase + trim + collapse whitespace)', () => {
    expect(normalizeSplitText('  Susu   BUBUK\t\nwhey ')).toBe('susu bubuk whey');
  });

  test('DSU union-find menggabung komponen', () => {
    const dsu = new LeakageDSU(4);
    dsu.union(0, 1);
    dsu.union(2, 3);
    expect(dsu.find(0)).toBe(dsu.find(1));
    expect(dsu.find(2)).toBe(dsu.find(3));
    expect(dsu.find(0)).not.toBe(dsu.find(2));
    dsu.union(1, 2);
    expect(dsu.find(0)).toBe(dsu.find(3));
  });

  test('satu deteksi selalu satu split + teks duplikat lintas deteksi satu split', () => {
    const svc = service();
    const rows = [
      item(1, 10, 'Air mineral murni'),
      item(2, 10, 'Air mineral murni (varian)'),
      item(3, 20, 'Air mineral murni'), // duplikat teks beda deteksi
      item(4, 30, 'Susu bubuk whey', 'unsafe'),
      item(5, 40, 'Tepung terigu protein tinggi', 'unsafe'),
      item(6, 50, 'Garam dapur beryodium'),
    ];
    const split = svc.buildSplitJson(rows as any);
    const whereOf = (id: number): string => {
      if (split.splits.train.includes(id)) return 'train';
      if (split.splits.val.includes(id)) return 'val';
      return 'test';
    };
    // 1 deteksi = 1 split
    expect(whereOf(1)).toBe(whereOf(2));
    // duplikat teks lintas deteksi = 1 split (union-find md5)
    expect(whereOf(1)).toBe(whereOf(3));
    // total utuh + disjoint
    const all = [...split.splits.train, ...split.splits.val, ...split.splits.test].sort((a, b) => a - b);
    expect(all).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('deterministik: dua panggilan hasil identik', () => {
    const svc = service();
    const rows = Array.from({ length: 12 }, (_, i) =>
      item(i + 1, 100 + i, `Teks sampel produk ${i + 1} whey`),
    );
    const a = svc.buildSplitJson(rows as any);
    const b = svc.buildSplitJson(rows as any);
    expect(a).toEqual(b);
    expect(a.seed).toBe(42);
    expect(a.ratios).toEqual({ train: 0.7, val: 0.15, test: 0.15 });
    expect(a.keyColumns).toEqual(['id']);
  });

  test('audit disjoint PASS + preflight/sessions/coverage lengkap', () => {
    const svc = service();
    const rows = Array.from({ length: 10 }, (_, i) =>
      item(i + 1, 200 + i, `Produk unik ${i + 1} kacang mede`, i % 2 ? 'unsafe' : 'safe'),
    );
    const split = svc.buildSplitJson(rows as any, { imageCount: 3, missingImages: 1 });
    for (const row of split.audit) {
      expect(row.overlap).toBe(0);
      expect(row.status).toBe('PASS');
    }
    expect(split.preflight.disjoint).toBe('PASS');
    expect(split.preflight.hasTestImages).toBe(true);
    expect(split.preflight.missingImages).toBe(1);
    expect(split.preflight.duplicateGroupsCapped).toBe(true);
    expect(split.preflight.frozenConflict).toBe('none');
    expect(split.coverage.total).toBe(10);
    expect(split.coverage.components).toBeGreaterThan(0);
    expect(split.sessions.train.count + split.sessions.val.count + split.sessions.test.count).toBe(10);
  });

  test('duplicateGroups di-cap 50', () => {
    const svc = service();
    const rows: any[] = [];
    for (let g = 0; g < 60; g += 1) {
      rows.push(item(g * 2 + 1, 300 + g, `Duplikat grup ${g} susu`));
      rows.push(item(g * 2 + 2, 400 + g, `Duplikat grup ${g} susu`));
    }
    const split = svc.buildSplitJson(rows as any);
    expect(split.duplicateGroupCount).toBeLessThanOrEqual(50);
    expect(split.duplicateGroups.length).toBeLessThanOrEqual(50);
  });

  test('auditSplitDisjoint mendeteksi overlap', () => {
    const rowsById = new Map([
      [1, { groupKey: 'd:1', textHash: 'h1' }],
      [2, { groupKey: 'd:1', textHash: 'h1' }],
    ]);
    const ok = auditSplitDisjoint([1, 2], [], [], rowsById);
    expect(ok.every((r) => r.status === 'PASS')).toBe(true);
    const bad = auditSplitDisjoint([1], [2], [], rowsById);
    expect(bad.some((r) => r.status === 'FAIL')).toBe(true);
  });
});
