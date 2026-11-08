import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import type { Response } from 'express';
import { Op } from 'sequelize';
import { DatasetItem } from './models/dataset-item.model';
import { Detection } from '../detections/models/detection.model';
import { DetectionAllergen } from '../detections/models/detection-allergen.model';
import { Allergen } from '../allergens/models/allergen.model';
import { Product } from '../products/models/product.model';
import { User } from '../users/models/user.model';
import { UpdateDatasetItemDto } from './dto/update-dataset-item.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');

const GOLD_LABELS = ['safe', 'unsafe'] as const;
const STATUSES = ['draft', 'verified'] as const;

function httpError(status: number, message: string, code: string, errors: Array<{ field: string; message: string }> = []) {
  throw new HttpException({ statusCode: status, message, code, errors }, status);
}

/** Escape CSV: gandakan " lalu bungkus bila mengandung , " \r \n. */
export function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function labelToId(label: string): number {
  return label === 'unsafe' ? 1 : 0;
}

export function datasetRowText(item: DatasetItem): string {
  const t = (item as any).correctedText ?? (item as any).corrected_text ?? item.ocrText ?? (item as any).ocr_text ?? '';
  return String(t ?? '');
}

/** PRNG seeded (mulberry32) untuk split deterministik. */
function mulberry32(seed: number) {
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

/** Normalisasi teks split (port leakage_split.normalize_ocr_text_v5, disederhanakan). */
export function normalizeSplitText(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Union-Find (DSU) untuk komponen leakage: 1 deteksi = 1 grup + teks duplikat = 1 komponen. */
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

/** Audit disjoint grup + exact-text antar train/val/test (port audit_split_no_leakage). */
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
  const pairs: Array<[string, number[], number[], 'groupKey' | 'textHash', string]> = [
    ['train', trainIds, 'val' as unknown as number[], 'groupKey', 'group train/val'],
  ];
  const frames = { train: trainIds, val: valIds, test: testIds };
  const comps: Array<[keyof typeof frames, keyof typeof frames, 'groupKey' | 'textHash', string]> = [
    ['train', 'val', 'groupKey', 'group train/val'],
    ['train', 'test', 'groupKey', 'group train/test'],
    ['val', 'test', 'groupKey', 'group val/test'],
    ['train', 'val', 'textHash', 'exact-text train/val'],
    ['train', 'test', 'textHash', 'exact-text train/test'],
    ['val', 'test', 'textHash', 'exact-text val/test'],
  ];
  void pairs;
  return comps.map(([a, b, col, label]) => {
    const sa = setOf(frames[a], col);
    const sb = setOf(frames[b], col);
    let overlap = 0;
    for (const v of sa) if (sb.has(v)) overlap += 1;
    return { comparison: label, overlap, status: overlap === 0 ? 'PASS' : 'FAIL' };
  });
}

@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);

  constructor(
    @InjectModel(DatasetItem)
    private datasetModel: typeof DatasetItem,
    @InjectModel(Detection)
    private detectionModel: typeof Detection,
    @InjectModel(DetectionAllergen)
    private detectionAllergenModel: typeof DetectionAllergen,
    @InjectModel(Allergen)
    private allergenModel: typeof Allergen,
    @Optional()
    @Inject('AUDIT_LOG_SERVICE')
    private readonly auditLogService?: {
      log?: (action: string, meta?: Record<string, unknown>) => Promise<void> | void;
    },
  ) {}

  /** Audit dataset.* — no-op bila provider absen (didokumentasikan di AuditLogService). */
  private async audit(action: string, meta: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.auditLogService?.log?.(`dataset.${action}`, meta);
    } catch (e) {
      this.logger.warn(`Audit dataset.${action} gagal: ${(e as any)?.message}`);
    }
  }

  private escapeLike(s: string) {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
  }

  /** Validasi nama alergen terhadap master allergens.name, throw 422 bila asing. */
  private async assertKnownAllergens(allergens: Array<{ name: string }>): Promise<void> {
    if (!Array.isArray(allergens) || allergens.length === 0) return;
    const names = [...new Set(allergens.map((a) => String(a?.name ?? '').trim()).filter(Boolean))];
    if (names.length === 0) return;
    const rows = await this.allergenModel.findAll({ where: { name: names }, attributes: ['name'] });
    const known = new Set(rows.map((r: any) => String(r.name)));
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      httpError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Alergen tidak dikenal: ${unknown.join(', ')}`,
        'UNKNOWN_ALLERGEN',
        unknown.map((n) => ({ field: 'corrected_allergens', message: `Alergen tidak dikenal: ${n}` })),
      );
    }
  }

  private datasetInclude() {
    return [
      {
        model: Detection,
        as: 'detection',
        required: false,
        include: [
          { model: Product, as: 'product', required: false },
          {
            model: DetectionAllergen,
            as: 'detectionAllergens',
            required: false,
            include: [{ model: Allergen, as: 'allergen', required: false }],
          },
        ],
      },
      {
        model: User,
        as: 'verifier',
        required: false,
        attributes: ['id', 'name', 'email', 'role'],
      },
    ];
  }

  async upsertFromDetection(detectionId: number, adminId?: number) {
    const detection: any = await this.detectionModel.findByPk(detectionId, {
      include: [
        {
          model: DetectionAllergen,
          as: 'detectionAllergens',
          include: [{ model: Allergen, as: 'allergen' }],
        },
      ],
    });
    if (!detection) {
      httpError(HttpStatus.NOT_FOUND, 'Deteksi tidak ditemukan', 'DETECTION_NOT_FOUND', []);
    }

    const existing = await this.datasetModel.findOne({ where: { detectionId } });
    if (existing) return existing;

    const rels: any[] = Array.isArray(detection.detectionAllergens) ? detection.detectionAllergens : [];
    const correctedAllergens = rels
      .map((r) => ({
        name: String(r?.allergen?.name ?? '').trim(),
        severity: (['low', 'medium', 'high', 'critical'] as string[]).includes(String(r?.allergen?.severityLevel))
          ? String(r.allergen.severityLevel)
          : 'medium',
        confidence: Number(r?.confidenceScore ?? 0) || 0,
      }))
      .filter((a) => a.name);

    const item = await this.datasetModel.create({
      detectionId,
      source: 'detection',
      ocrText: detection.ocrText ?? null,
      correctedText: null,
      goldLabel: detection.result,
      correctedAllergens: correctedAllergens.length ? correctedAllergens : null,
      status: 'draft',
      notes: null,
    } as any);

    await this.audit('upsert', { detectionId, datasetId: (item as any).id, adminId: adminId ?? null });
    return item;
  }

  async findAll(query: { page?: number; limit?: number; status?: string; label?: string; search?: string }) {
    const safePage = Number.isFinite(+query.page) && +query.page > 0 ? Math.floor(+query.page) : 1;
    const safeLimit =
      Number.isFinite(+query.limit) && +query.limit > 0 ? Math.min(Math.floor(+query.limit), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const where: any = {};
    if (query.status === 'draft' || query.status === 'verified') where.status = query.status;
    if (query.label === 'safe' || query.label === 'unsafe') where.goldLabel = query.label;
    if (query.search && String(query.search).trim()) {
      const raw = String(query.search).trim().slice(0, 100);
      const like = { [Op.like]: `%${this.escapeLike(raw)}%` };
      where[Op.or] = [{ correctedText: like }, { ocrText: like }];
    }
    const { rows, count } = await this.datasetModel.findAndCountAll({
      where,
      include: this.datasetInclude(),
      offset,
      limit: safeLimit,
      order: [['createdAt', 'DESC']],
    });
    return {
      data: rows,
      total: count,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    };
  }

  async findById(id: number) {
    const item = await this.datasetModel.findByPk(id, { include: this.datasetInclude() });
    if (!item) {
      httpError(HttpStatus.NOT_FOUND, 'Dataset item tidak ditemukan', 'DATASET_NOT_FOUND', []);
    }
    return item;
  }

  async update(id: number, dto: UpdateDatasetItemDto, adminId?: number) {
    const item: any = await this.findById(id);

    if (dto.corrected_allergens !== undefined) {
      await this.assertKnownAllergens(dto.corrected_allergens ?? []);
      item.correctedAllergens = dto.corrected_allergens;
    }
    if (dto.corrected_text !== undefined) item.correctedText = dto.corrected_text;
    if (dto.gold_label !== undefined) {
      if (!(GOLD_LABELS as readonly string[]).includes(dto.gold_label)) {
        httpError(HttpStatus.BAD_REQUEST, 'gold_label harus safe atau unsafe', 'INVALID_GOLD_LABEL', []);
      }
      item.goldLabel = dto.gold_label;
    }
    if (dto.notes !== undefined) item.notes = dto.notes;
    if (dto.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(dto.status)) {
        httpError(HttpStatus.BAD_REQUEST, 'status harus draft atau verified', 'INVALID_STATUS', []);
      }
      item.status = dto.status;
      if (dto.status === 'verified') {
        item.verifiedBy = adminId ?? item.verifiedBy ?? null;
        item.verifiedAt = new Date();
      } else {
        item.verifiedBy = null;
        item.verifiedAt = null;
      }
    }

    await item.save();
    await this.audit('update', { datasetId: id, adminId: adminId ?? null });
    return this.findById(id);
  }

  async remove(id: number, adminId?: number) {
    const item = await this.findById(id);
    await (item as any).destroy();
    await this.audit('remove', { datasetId: id, adminId: adminId ?? null });
    return { message: 'Dataset item dihapus' };
  }

  async markVerified(id: number, adminId?: number) {
    const item: any = await this.findById(id);
    item.status = 'verified';
    item.verifiedBy = adminId ?? item.verifiedBy ?? null;
    item.verifiedAt = new Date();
    await item.save();
    await this.audit('verify', { datasetId: id, adminId: adminId ?? null });
    return this.findById(id);
  }

  async unmarkVerified(id: number, adminId?: number) {
    const item: any = await this.findById(id);
    item.status = 'draft';
    item.verifiedBy = null;
    item.verifiedAt = null;
    await item.save();
    await this.audit('unverify', { datasetId: id, adminId: adminId ?? null });
    return this.findById(id);
  }

  /** Filter export/unduh: default HANYA verified; draft ikut hanya bila ?status=draft eksplisit. */
  private exportWhere(query: { status?: string; label?: string }) {
    const where: any = {};
    if (query.status === 'draft' || query.status === 'verified') {
      where.status = query.status;
    } else {
      where.status = 'verified';
    }
    if (query.label === 'safe' || query.label === 'unsafe') where.goldLabel = query.label;
    return { where, effectiveStatus: where.status as string };
  }

  private async exportRows(query: { status?: string; label?: string }) {
    const { where, effectiveStatus } = this.exportWhere(query);
    const rows = await this.datasetModel.findAll({
      where,
      include: this.datasetInclude(),
      order: [['id', 'ASC']],
    });
    return { rows, effectiveStatus };
  }

  buildExportCsv(rows: DatasetItem[]): string {
    const lines = ['text,label_id,label'];
    for (const r of rows) {
      const text = datasetRowText(r);
      const label = String((r as any).goldLabel ?? (r as any).gold_label ?? 'safe');
      lines.push(`${csvEscape(text)},${labelToId(label)},${csvEscape(label)}`);
    }
    return lines.join('\n') + '\n';
  }

  async exportToResponse(query: { status?: string; label?: string; format?: string }, res: Response, adminId?: number) {
    const format = query.format === 'json' ? 'json' : 'csv';
    const { rows, effectiveStatus } = await this.exportRows(query);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await this.audit('export', {
      format,
      status: effectiveStatus,
      label: query.label ?? null,
      count: rows.length,
      adminId: adminId ?? null,
    });
    if (format === 'json') {
      const payload = rows.map((r: any) => ({
        id: r.id,
        text: datasetRowText(r),
        label_id: labelToId(String(r.goldLabel ?? 'safe')),
        label: String(r.goldLabel ?? 'safe'),
      }));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="dataset_export_${stamp}.json"`);
      res.status(200).send(JSON.stringify(payload, null, 2));
      return;
    }
    const csv = this.buildExportCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dataset_export_${stamp}.csv"`);
    res.status(200).send(csv);
  }

  private imageDiskPath(imageUrl?: string | null): string | null {
    if (!imageUrl || !String(imageUrl).trim()) return null;
    return join(process.cwd(), 'uploads', basename(String(imageUrl)));
  }

  private manifestRow(r: any): { line: string; imageFound: boolean; fileFound: boolean; ext: string; diskPath: string | null } {
    const det = r.detection ?? null;
    const imageUrl = det?.imageUrl ?? det?.image_url ?? null;
    const diskPath = this.imageDiskPath(imageUrl);
    const imageFound = !!imageUrl;
    let fileFound = false;
    if (diskPath) {
      try {
        fileFound = existsSync(diskPath) && statSync(diskPath).isFile();
      } catch {
        fileFound = false;
      }
    }
    const ext = imageUrl ? extname(basename(String(imageUrl))).toLowerCase() || '.jpg' : '.jpg';
    const verifiedAt = r.verifiedAt ?? r.verified_at ?? null;
    const cols = [
      r.id,
      r.detectionId ?? r.detection_id ?? '',
      r.source ?? '',
      r.goldLabel ?? r.gold_label ?? '',
      r.status ?? '',
      det?.modelName ?? det?.model_name ?? '',
      det?.detectionMethod ?? det?.detection_method ?? '',
      imageFound,
      fileFound,
      r.verifiedBy ?? r.verified_by ?? '',
      verifiedAt ? new Date(verifiedAt).toISOString() : '',
    ];
    return { line: cols.map(csvEscape).join(','), imageFound, fileFound, ext, diskPath };
  }

  buildManifestCsv(rows: DatasetItem[]): { csv: string; files: Array<{ entry: string; diskPath: string }>; missing: number } {
    const lines = ['id,detection_id,source,gold_label,status,model_name,detection_method,image_found,file_found,verified_by,verified_at'];
    const files: Array<{ entry: string; diskPath: string }> = [];
    let missing = 0;
    for (const r of rows) {
      const m = this.manifestRow(r);
      lines.push(m.line);
      // Tanpa fallback: file hilang → file_found=false dan tidak masuk ZIP.
      if (m.fileFound && m.diskPath) {
        files.push({ entry: `images/${(r as any).id}${m.ext}`, diskPath: m.diskPath });
      } else if (m.imageFound && !m.fileFound) {
        missing += 1;
      }
    }
    return { csv: lines.join('\n') + '\n', files, missing };
  }

  /**
   * Split anti-leakage port leakage_split V5 (skala kecil: grup=deteksi, bukan product):
   * union-find atas (detection-group + hash teks ternormalisasi) → 1 komponen = 1 split.
   * Deterministik seed 42, rasio 70/15/15 per komponen. Audit disjoint grup + exact-text.
   */
  buildSplitJson(
    rows: DatasetItem[],
    opts: { imageCount?: number; missingImages?: number } = {},
  ) {
    const ids = rows.map((r) => (r as any).id as number);
    const idxOf = new Map<number, number>();
    ids.forEach((id, i) => idxOf.set(id, i));
    const dsu = new LeakageDSU(Math.max(rows.length, 0));

    // Union by detection-group.
    const firstByGroup = new Map<string, number>();
    const groupKeyOf = (r: DatasetItem): string => {
      const detId = (r as any).detectionId ?? (r as any).detection_id ?? null;
      return detId != null ? `d:${detId}` : `i:${(r as any).id}`;
    };
    rows.forEach((r, i) => {
      const key = groupKeyOf(r);
      const first = firstByGroup.get(key);
      if (first === undefined) firstByGroup.set(key, i);
      else dsu.union(first, i);
    });

    // Union by md5 teks ternormalisasi (duplikat lintas deteksi tetap satu komponen).
    const byHash = new Map<string, number[]>();
    const textHashOf = new Map<number, string>();
    const rowsById = new Map<number, { groupKey: string; textHash: string }>();
    rows.forEach((r, i) => {
      const id = (r as any).id as number;
      const normalized = normalizeSplitText(datasetRowText(r));
      const groupKey = groupKeyOf(r);
      if (!normalized) {
        rowsById.set(id, { groupKey, textHash: '' });
        return;
      }
      const hash = createHash('md5').update(normalized, 'utf8').digest('hex');
      textHashOf.set(id, hash);
      rowsById.set(id, { groupKey, textHash: hash });
      const list = byHash.get(hash) ?? [];
      list.push(id);
      byHash.set(hash, list);
    });
    for (const [, dupIds] of byHash) {
      if (dupIds.length < 2) continue;
      const first = idxOf.get(dupIds[0])!;
      for (let k = 1; k < dupIds.length; k += 1) dsu.union(first, idxOf.get(dupIds[k])!);
    }
    // Lengkapi rowsById untuk teks kosong.
    for (const r of rows) {
      const id = (r as any).id as number;
      if (!rowsById.has(id)) rowsById.set(id, { groupKey: groupKeyOf(r), textHash: '' });
    }

    // Komponen leakage → lookup deterministik (port _build_components).
    const compMembers = dsu.components();
    const compIds = [...compMembers.keys()].sort((a, b) => a - b);
    const compLookup: Record<number, { component_id: number; ids: number[]; n_rows: number }> = {};
    for (const root of compIds) {
      const members = (compMembers.get(root) ?? []).map((i) => ids[i]).sort((a, b) => a - b);
      const cid = Math.min(...members);
      compLookup[cid] = { component_id: cid, ids: members, n_rows: members.length };
    }
    const compKeys = Object.keys(compLookup)
      .map(Number)
      .sort((a, b) => a - b);
    const ordered = seededShuffle(compKeys, 42);
    const n = ordered.length;
    const trainComps = Math.floor(n * 0.7);
    const valComps = Math.floor(n * 0.15);
    const train: number[] = [];
    const val: number[] = [];
    const test: number[] = [];
    ordered.forEach((cid, i) => {
      const members = compLookup[cid].ids;
      if (i < trainComps) train.push(...members);
      else if (i < trainComps + valComps) val.push(...members);
      else test.push(...members);
    });
    train.sort((a, b) => a - b);
    val.sort((a, b) => a - b);
    test.sort((a, b) => a - b);

    // Duplikat teks: deterministik (sort by hash), cap 50 grup.
    const duplicateGroups = [...byHash.entries()]
      .filter(([, dupIds]) => dupIds.length > 1)
      .map(([hash, dupIds]) => ({ hash, ids: [...dupIds].sort((a, b) => a - b) }))
      .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
      .slice(0, 50);
    const duplicateGroupCount = duplicateGroups.length;
    const uniqueTexts = byHash.size;
    const duplicateIds = duplicateGroups.reduce((acc, g) => acc + g.ids.length, 0);

    // Audit disjoint (port audit_split_no_leakage): grup + exact-text train/val/test.
    const audit = auditSplitDisjoint(train, val, test, rowsById);
    const disjoint = audit.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL';
    if (disjoint === 'FAIL') {
      this.logger.warn(`Split audit FAIL: ${JSON.stringify(audit)}`);
    }

    // Sessions: komposisi label per split (coverage sesi train/val/test).
    const labelOf = (id: number): string => {
      const r = rows.find((x) => (x as any).id === id) as any;
      return String(r?.goldLabel ?? r?.gold_label ?? 'safe');
    };
    const sessionOf = (list: number[]) => {
      let safe = 0;
      let unsafe = 0;
      for (const id of list) {
        if (labelOf(id) === 'unsafe') unsafe += 1;
        else safe += 1;
      }
      return { ids: list, count: list.length, safe, unsafe };
    };
    const sessions = { train: sessionOf(train), val: sessionOf(val), test: sessionOf(test) };

    // Preflight: kesiapan unduh/train (port gagasan V5 sessions/preflight).
    const imageCount = opts.imageCount ?? 0;
    const missingImages = opts.missingImages ?? 0;
    const preflight = {
      disjoint,
      hasTestImages: imageCount > 0,
      missingImages,
      duplicateGroups: duplicateGroupCount,
      duplicateGroupsCapped: duplicateGroupCount <= 50,
      frozenConflict: 'none' as const,
    };

    return {
      seed: 42,
      ratios: { train: 0.7, val: 0.15, test: 0.15 },
      keyColumns: ['id'],
      groupBy: 'detection_id||id',
      splits: { train, val, test },
      counts: { train: train.length, val: val.length, test: test.length, total: rows.length },
      duplicateGroups,
      duplicateGroupCount,
      coverage: {
        groups: firstByGroup.size,
        components: compKeys.length,
        uniqueTexts,
        total: rows.length,
        duplicateIds,
      },
      components: compKeys.map((cid) => compLookup[cid]),
      audit,
      sessions,
      preflight,
    };
  }

  buildReadmeTxt(opts: {
    status: string;
    label?: string | null;
    total: number;
    counts: { train: number; val: number; test: number };
    duplicateGroupCount?: number;
    includeLabels?: boolean;
    includeImages?: boolean;
    includeSplit?: boolean;
    coverage?: { groups: number; components: number; uniqueTexts: number; total: number; duplicateIds: number };
    audit?: SplitAuditRow[];
    preflight?: { disjoint: string; hasTestImages: boolean; missingImages: number; duplicateGroups: number; duplicateGroupsCapped: boolean; frozenConflict: string };
  }): string {
    const { status, label, total, counts } = opts;
    const duplicateGroupCount = opts.duplicateGroupCount ?? 0;
    const includeLabels = opts.includeLabels ?? true;
    const includeImages = opts.includeImages ?? true;
    const includeSplit = opts.includeSplit ?? true;
    const coverage = opts.coverage;
    const audit = opts.audit ?? [];
    const preflight = opts.preflight;
    const contentLines = [
      '- manifest.csv : id,detection_id,source,gold_label,status,model_name,detection_method,image_found,file_found,verified_by,verified_at',
      ...(includeLabels ? ['- dataset.csv : text,label_id,label'] : []),
      ...(includeImages ? ['- images/<id>.<ext> : citra sumber bila file masih ada di ./uploads (tanpa fallback)'] : []),
      ...(includeSplit
        ? ['- split.json : seed 42 + Fisher-Yates + DSU (detection_id + md5 teks) + splits/counts + duplicateGroups(cap 50) + coverage + components + audit + sessions + preflight']
        : []),
    ];
    return [
      'Dataset Ekspor Alergen (Bu Dian)',
      '=================================',
      `Dibuat: ${new Date().toISOString()}`,
      `Filter: status=${status}${label ? `, label=${label}` : ''}`,
      `Jumlah item: ${total}`,
      '',
      'Label: 0=safe, 1=unsafe',
      'Gabung ke train: CSV_DELIMITER="," (backend koma) vs train default ";" — set CSV_DELIMITER="," saat gabung; nama_produk disintesis produk_{i}.',
      'Split: seed 42, train 70% / val 15% / test 15% (union-find detection_id||id + md5 teks, 1 komponen = 1 split, anti-leakage)',
      `Split counts: train=${counts.train}, val=${counts.val}, test=${counts.test}`,
      ...(coverage
        ? [
            `Coverage: groups=${coverage.groups}, components=${coverage.components}, uniqueTexts=${coverage.uniqueTexts}, total=${coverage.total}, duplicateIds=${coverage.duplicateIds}`,
          ]
        : []),
      ...(audit.length ? [`Audit: ${audit.map((a) => `${a.comparison}=${a.status}`).join(', ')}`] : []),
      ...(preflight
        ? [
            `Preflight: disjoint=${preflight.disjoint}, hasTestImages=${preflight.hasTestImages}, missingImages=${preflight.missingImages}, duplicateGroups=${preflight.duplicateGroups} (cap 50: ${preflight.duplicateGroupsCapped}), frozenConflict=${preflight.frozenConflict}`,
          ]
        : []),
      '',
      'Isi berkas:',
      ...contentLines,
      `Duplikat teks: ${duplicateGroupCount} grup (>1 id; normalisasi lowercase+trim+collapse whitespace, hash md5, union-find, cap 50)`,
      '',
      'Contoh valid:',
      'text,label_id,label',
      'Air mineral murni,0,safe',
      '"Susu bubuk, mengandung ""kacang"" dan whey",1,unsafe',
      '',
    ].join('\n');
  }

  private parseIncludes(query: { includeLabels?: unknown; includeImages?: unknown; includeSplit?: unknown }) {
    const asBool = (v: unknown, def = true): boolean => {
      if (v === undefined || v === null || v === '') return def;
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      if (['0', 'false', 'no', 'off'].includes(s)) return false;
      if (['1', 'true', 'yes', 'on'].includes(s)) return true;
      return def;
    };
    return {
      includeLabels: asBool((query as any)?.includeLabels, true),
      includeImages: asBool((query as any)?.includeImages, true),
      includeSplit: asBool((query as any)?.includeSplit, true),
    };
  }

  async estimateDownload(query: { status?: string; label?: string; includeLabels?: unknown; includeImages?: unknown; includeSplit?: unknown }) {
    const { rows, effectiveStatus } = await this.exportRows(query);
    const { includeLabels, includeImages, includeSplit } = this.parseIncludes(query);
    const datasetCsv = includeLabels ? this.buildExportCsv(rows) : '';
    const { csv: manifestCsv, files, missing: manifestMissing } = this.buildManifestCsv(rows);
    const includedFiles = includeImages ? files : [];
    let imagesBytes = 0;
    let statMissing = 0;
    for (const f of includedFiles) {
      try {
        imagesBytes += statSync(f.diskPath).size;
      } catch {
        statMissing += 1;
      }
    }
    const missing = manifestMissing + statMissing;
    const split = this.buildSplitJson(rows, { imageCount: includedFiles.length, missingImages: missing });
    const splitJson = includeSplit ? JSON.stringify(split, null, 2) : '';
    const readme = this.buildReadmeTxt({
      status: effectiveStatus,
      label: query.label ?? null,
      total: rows.length,
      counts: split.counts,
      duplicateGroupCount: split.duplicateGroupCount,
      includeLabels,
      includeImages,
      includeSplit,
      coverage: (split as any).coverage,
      audit: (split as any).audit,
      preflight: (split as any).preflight,
    });
    const parts = {
      datasetCsv: { bytes: Buffer.byteLength(datasetCsv, 'utf8'), rows: includeLabels ? rows.length : 0 },
      manifestCsv: { bytes: Buffer.byteLength(manifestCsv, 'utf8'), rows: rows.length },
      images: { bytes: imagesBytes, count: includedFiles.length, missing },
      splitJson: { bytes: Buffer.byteLength(splitJson, 'utf8') },
      readmeTxt: { bytes: Buffer.byteLength(readme, 'utf8') },
    };
    const overheadPerFile = 128;
    const fileCount =
      1 + // manifest
      1 + // readme
      (includeLabels ? 1 : 0) +
      (includeSplit ? 1 : 0) +
      includedFiles.length;
    const bytes =
      parts.datasetCsv.bytes +
      parts.manifestCsv.bytes +
      parts.images.bytes +
      parts.splitJson.bytes +
      parts.readmeTxt.bytes +
      fileCount * overheadPerFile;
    return { bytes, fileCount, breakdown: { ...parts, missing } };
  }

  async downloadToResponse(
    query: { status?: string; label?: string; includeLabels?: unknown; includeImages?: unknown; includeSplit?: unknown },
    res: Response,
    adminId?: number,
  ) {
    const { rows, effectiveStatus } = await this.exportRows(query);
    const { includeLabels, includeImages, includeSplit } = this.parseIncludes(query);
    const datasetCsv = includeLabels ? this.buildExportCsv(rows) : '';
    const { csv: manifestCsv, files, missing: manifestMissing } = this.buildManifestCsv(rows);
    const includedFiles = includeImages ? files : [];
    const split = this.buildSplitJson(rows, { imageCount: includedFiles.length, missingImages: manifestMissing });
    const splitJson = includeSplit ? JSON.stringify(split, null, 2) : '';
    const readme = this.buildReadmeTxt({
      status: effectiveStatus,
      label: query.label ?? null,
      total: rows.length,
      counts: split.counts,
      duplicateGroupCount: split.duplicateGroupCount,
      includeLabels,
      includeImages,
      includeSplit,
      coverage: (split as any).coverage,
      audit: (split as any).audit,
      preflight: (split as any).preflight,
    });

    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    const filename = `dataset_${ymd}_${rows.length}items.zip`;

    await this.audit('download', {
      status: effectiveStatus,
      label: query.label ?? null,
      count: rows.length,
      images: includedFiles.length,
      missingImages: manifestMissing,
      includeLabels,
      includeImages,
      includeSplit,
      disjoint: (split as any).preflight?.disjoint ?? 'UNKNOWN',
      duplicateGroups: (split as any).duplicateGroupCount ?? 0,
      adminId: adminId ?? null,
    });

    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', (err: any) => {
      this.logger.warn(`Arsip ZIP: ${err?.message}`);
    });
    archive.on('error', (err: any) => {
      this.logger.warn(`Arsip ZIP gagal: ${err?.message}`);
      try {
        if (!res.writableEnded) res.end();
      } catch {
        /* abaikan */
      }
    });
    archive.pipe(res);
    if (includeLabels) archive.append(datasetCsv, { name: 'dataset.csv' });
    archive.append(manifestCsv, { name: 'manifest.csv' });
    for (const f of includedFiles) {
      archive.file(f.diskPath, { name: f.entry });
    }
    if (includeSplit) archive.append(splitJson, { name: 'split.json' });
    archive.append(readme, { name: 'README.txt' });
    await archive.finalize();
  }
}
