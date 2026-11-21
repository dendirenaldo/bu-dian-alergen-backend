import { createHash } from 'node:crypto';

/** PRNG seeded (mulberry32) untuk split deterministik. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle dengan PRNG seeded (tidak mutasi input). */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Normalisasi teks split (lowercase, trim, collapse whitespace). */
export function normalizeSplitText(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function textHash(raw: unknown): string {
  return createHash('md5').update(normalizeSplitText(raw), 'utf8').digest('hex');
}

/** Union-Find (DSU) untuk komponen leakage: grup + teks duplikat = 1 komponen. */
export class LeakageDSU {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    let r = a;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[a] !== a) {
      const nxt = this.parent[a];
      this.parent[a] = r;
      a = nxt;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
  components(): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i += 1) {
      const r = this.find(i);
      const list = out.get(r) ?? [];
      list.push(i);
      out.set(r, list);
    }
    return out;
  }
}

export interface SplitAuditRow {
  comparison: string;
  overlap: number;
  status: 'PASS' | 'FAIL';
}

/** Audit disjoint grup + exact-text antar train/val/test. */
export function auditSplitDisjoint(
  trainIds: number[],
  valIds: number[],
  testIds: number[],
  rowsById: Map<number, { groupKey: string; textHash: string }>,
): SplitAuditRow[] {
  const setOf = (ids: number[], col: 'groupKey' | 'textHash'): Set<string> => {
    const s = new Set<string>();
    for (const id of ids) {
      const v = rowsById.get(id)?.[col] ?? '';
      if (v) s.add(v);
    }
    return s;
  };
  const frames = { train: trainIds, val: valIds, test: testIds };
  const comps: Array<[keyof typeof frames, keyof typeof frames, 'groupKey' | 'textHash', string]> = [
    ['train', 'val', 'groupKey', 'group train/val'],
    ['train', 'test', 'groupKey', 'group train/test'],
    ['val', 'test', 'groupKey', 'group val/test'],
    ['train', 'val', 'textHash', 'exact-text train/val'],
    ['train', 'test', 'textHash', 'exact-text train/test'],
    ['val', 'test', 'textHash', 'exact-text val/test'],
  ];
  return comps.map(([a, b, col, label]) => {
    const sa = setOf(frames[a], col);
    const sb = setOf(frames[b], col);
    let overlap = 0;
    for (const v of sa) if (sb.has(v)) overlap += 1;
    return { comparison: label, overlap, status: overlap === 0 ? 'PASS' : 'FAIL' };
  });
}

export interface SplitRatios {
  train: number;
  validation: number;
  test: number;
}

export interface ConfiguredSplitInput {
  id: number;
  groupKey: string;
  textHash: string;
  /** Label multilabel biner (mis. ['safe'] / ['unsafe', 'allergen_gluten']). */
  labels: string[];
}

export interface ConfiguredSplitResult {
  seed: number;
  ratios: SplitRatios;
  strategy: string;
  groupBy: string;
  splits: { train: number[]; validation: number[]; test: number[] };
  counts: { train: number; validation: number; test: number; total: number };
  groupCount: number;
  audit: SplitAuditRow[];
  labelDistribution: Record<string, { train: number; validation: number; test: number }>;
  duplicateGroupCount: number;
  warning?: string;
}

/**
 * Split sadar-grup dengan stratifikasi multilabel "greedy".
 *
 * - Record digabung per grup (deteksi / hash teks / tidak digabung).
 * - Grup diacak deterministik dengan seed, lalu ditugaskan ke split yang
 *   paling kekurangan kuota rasio, dengan penalti ketidakseimbangan label.
 * - Tidak ada record di dua split; audit disjoint dijalankan setelahnya.
 *
 * Ini bukan iterative stratification penuh, tetapi mencegah kebocoran grup
 * dan menjaga sebaran label tetap wajar. Batasannya didokumentasikan.
 */
export function buildConfiguredSplit(
  rows: ConfiguredSplitInput[],
  opts: {
    seed?: number;
    ratios?: Partial<SplitRatios>;
    strategy?: string;
    groupBy?: string;
  } = {},
): ConfiguredSplitResult {
  const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 42;
  const train = Math.max(0, Number(opts.ratios?.train ?? 0.7));
  const validation = Math.max(0, Number(opts.ratios?.validation ?? 0.15));
  const test = Math.max(0, Number(opts.ratios?.test ?? 0.15));
  const total = train + validation + test || 1;
  const ratios: SplitRatios = {
    train: train / total,
    validation: validation / total,
    test: test / total,
  };
  const strategy = String(opts.strategy ?? 'multilabel');
  const groupBy = String(opts.groupBy ?? 'detection');

  const idxOf = new Map<number, number>();
  rows.forEach((r, i) => idxOf.set(r.id, i));
  const dsu = new LeakageDSU(rows.length);
  const groupIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = groupBy === 'none' ? `i:${r.id}` : groupBy === 'text' ? (r.textHash ? `t:${r.textHash}` : `i:${r.id}`) : r.groupKey;
    const first = groupIndex.get(key);
    if (first === undefined) groupIndex.set(key, i);
    else dsu.union(first, i);
  });
  // Text-hash duplicates tetap satu komponen walau groupBy=detection.
  const byHash = new Map<string, number[]>();
  rows.forEach((r) => {
    if (!r.textHash) return;
    const list = byHash.get(r.textHash) ?? [];
    list.push(r.id);
    byHash.set(r.textHash, list);
  });
  for (const [, ids] of byHash) {
    if (ids.length < 2) continue;
    const first = idxOf.get(ids[0])!;
    for (let k = 1; k < ids.length; k += 1) dsu.union(first, idxOf.get(ids[k])!);
  }

  const compMembers = dsu.components();
  const comps = [...compMembers.values()]
    .map((memberIdx) => {
      const ids = memberIdx.map((i) => rows[i].id).sort((a, b) => a - b);
      return { key: Math.min(...ids), ids };
    })
    .sort((a, b) => a.key - b.key);

  const ordered = seededShuffle(comps, seed);
  const buckets: Record<'train' | 'validation' | 'test', number[]> = {
    train: [],
    validation: [],
    test: [],
  };
  const labelCounts: Record<'train' | 'validation' | 'test', Map<string, number>> = {
    train: new Map(),
    validation: new Map(),
    test: new Map(),
  };
  const labelPresence = new Map<string, Set<'train' | 'validation' | 'test'>>();
  const assign = (split: 'train' | 'validation' | 'test', comp: { ids: number[] }) => {
    for (const id of comp.ids) {
      buckets[split].push(id);
      const row = rows[idxOf.get(id)!];
      for (const label of row.labels) {
        labelCounts[split].set(label, (labelCounts[split].get(label) ?? 0) + 1);
        const set = labelPresence.get(label) ?? new Set();
        set.add(split);
        labelPresence.set(label, set);
      }
    }
  };

  // Komponen dievaluasi berurutan; pilih split dengan defisit kuota terbesar,
  // lalu penalti bila label komponen belum hadir di split tersebut.
  const assignedCount = { train: 0, validation: 0, test: 0 };
  const totalRecords = rows.length || 1;
  for (const comp of ordered) {
    const deficit = (split: 'train' | 'validation' | 'test') =>
      ratios[split] * totalRecords - assignedCount[split];
    const candidates: Array<'train' | 'validation' | 'test'> = ['train', 'validation', 'test'];
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const split of candidates) {
      const compLabels = new Set<string>();
      for (const id of comp.ids) for (const l of rows[idxOf.get(id)!].labels) compLabels.add(l);
      let missing = 0;
      if (strategy !== 'random') {
        for (const label of compLabels) {
          const seen = labelPresence.get(label);
          if (!seen || !seen.has(split)) missing += 1;
        }
      }
      const score = deficit(split) - missing * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = split;
      }
    }
    assign(best, comp);
    assignedCount[best] += comp.ids.length;
  }

  // Dataset kecil: pastikan split yang diminta tidak kosong bila komponen
  // cukup (minimal 3). Pindahkan SATU komponen utuh agar tidak bocor.
  if (comps.length >= 3) {
    const compsIn = (split: 'train' | 'validation' | 'test') =>
      comps.filter((c) => c.ids.every((id) => buckets[split].includes(id)));
    const move = (from: 'train' | 'validation' | 'test', to: 'train' | 'validation' | 'test') => {
      const candidates = compsIn(from).sort((a, b) => a.ids.length - b.ids.length || a.key - b.key);
      const comp = candidates[0];
      if (!comp) return false;
      const set = new Set(comp.ids);
      buckets[from] = buckets[from].filter((id) => !set.has(id));
      buckets[to].push(...comp.ids);
      return true;
    };
    if (ratios.validation > 0 && buckets.validation.length === 0) move('train', 'validation');
    if (ratios.test > 0 && buckets.test.length === 0) {
      if (!move('train', 'test')) move('validation', 'test');
    }
    // Bangun ulang hitungan label setelah perpindahan.
    for (const split of ['train', 'validation', 'test'] as const) {
      labelCounts[split] = new Map();
      for (const id of buckets[split]) {
        for (const label of rows[idxOf.get(id)!].labels) {
          labelCounts[split].set(label, (labelCounts[split].get(label) ?? 0) + 1);
        }
      }
    }
  }

  const sortAsc = (a: number, b: number) => a - b;
  buckets.train.sort(sortAsc);
  buckets.validation.sort(sortAsc);
  buckets.test.sort(sortAsc);

  const rowsById = new Map<number, { groupKey: string; textHash: string }>();
  for (const r of rows) rowsById.set(r.id, { groupKey: r.groupKey, textHash: r.textHash });
  const audit = auditSplitDisjoint(buckets.train, buckets.validation, buckets.test, rowsById);

  const allLabels = [...new Set(rows.flatMap((r) => r.labels))].sort();
  const labelDistribution: Record<string, { train: number; validation: number; test: number }> = {};
  for (const label of allLabels) {
    labelDistribution[label] = {
      train: labelCounts.train.get(label) ?? 0,
      validation: labelCounts.validation.get(label) ?? 0,
      test: labelCounts.test.get(label) ?? 0,
    };
  }

  const duplicateGroupCount = [...byHash.values()].filter((ids) => ids.length > 1).length;
  const emptyRequested =
    (ratios.validation > 0 && buckets.validation.length === 0) ||
    (ratios.test > 0 && buckets.test.length === 0);
  const warning = audit.some((a) => a.status === 'FAIL')
    ? 'Audit split mendeteksi tumpang tindih; periksa duplicateGroups.'
    : emptyRequested
      ? 'Dataset terlalu kecil untuk mengisi semua split; periksa counts.'
      : undefined;
  if (opts.strategy === 'multilabel' && allLabels.length > 1) {
    // Multi-label: tidak ada stratifikasi eksklusif; gunakan greedy di atas.
  }

  return {
    seed,
    ratios: {
      train: Number(ratios.train.toFixed(4)),
      validation: Number(ratios.validation.toFixed(4)),
      test: Number(ratios.test.toFixed(4)),
    },
    strategy,
    groupBy,
    splits: buckets,
    counts: {
      train: buckets.train.length,
      validation: buckets.validation.length,
      test: buckets.test.length,
      total: rows.length,
    },
    groupCount: comps.length,
    audit,
    labelDistribution,
    duplicateGroupCount,
    warning,
  };
}
