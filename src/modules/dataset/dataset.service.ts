import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
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
    @Optional() @Inject('AUDIT_LOG_SERVICE') private readonly auditLogService?: {
      log?: (action: string, meta?: Record<string, unknown>) => Promise<void> | void;
    },
  ) {}

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

  buildManifestCsv(rows: DatasetItem[]): { csv: string; files: Array<{ entry: string; diskPath: string }> } {
    const lines = ['id,detection_id,source,gold_label,status,model_name,detection_method,image_found,file_found,verified_by,verified_at'];
    const files: Array<{ entry: string; diskPath: string }> = [];
    for (const r of rows) {
      const m = this.manifestRow(r);
      lines.push(m.line);
      // Tanpa fallback: file hilang → file_found=false dan tidak masuk ZIP.
      if (m.fileFound && m.diskPath) {
        files.push({ entry: `images/${(r as any).id}${m.ext}`, diskPath: m.diskPath });
      }
    }
    return { csv: lines.join('\n') + '\n', files };
  }

  buildSplitJson(rows: DatasetItem[]) {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const detId = (r as any).detectionId ?? (r as any).detection_id ?? null;
      const key = detId != null ? `d:${detId}` : `i:${(r as any).id}`;
      const list = groups.get(key) ?? [];
      list.push((r as any).id);
      groups.set(key, list);
    }
    const keys = seededShuffle([...groups.keys()], 42);
    const n = keys.length;
    const trainGroups = Math.floor(n * 0.7);
    const valGroups = Math.floor(n * 0.15);
    const train: number[] = [];
    const val: number[] = [];
    const test: number[] = [];
    keys.forEach((k, i) => {
      const ids = groups.get(k) ?? [];
      if (i < trainGroups) train.push(...ids);
      else if (i < trainGroups + valGroups) val.push(...ids);
      else test.push(...ids);
    });
    train.sort((a, b) => a - b);
    val.sort((a, b) => a - b);
    test.sort((a, b) => a - b);
    return {
      seed: 42,
      ratios: { train: 0.7, val: 0.15, test: 0.15 },
      keyColumns: ['id'],
      groupBy: 'detection_id||id',
      splits: { train, val, test },
      counts: { train: train.length, val: val.length, test: test.length, total: rows.length },
    };
  }

  buildReadmeTxt(opts: { status: string; label?: string | null; total: number; counts: { train: number; val: number; test: number } }): string {
    const { status, label, total, counts } = opts;
    return [
      'Dataset Ekspor Alergen (Bu Dian)',
      '=================================',
      `Dibuat: ${new Date().toISOString()}`,
      `Filter: status=${status}${label ? `, label=${label}` : ''}`,
      `Jumlah item: ${total}`,
      '',
      'Label: 0=safe, 1=unsafe',
      'Split: seed 42, train 70% / val 15% / test 15% (group by detection_id||id)',
      `Split counts: train=${counts.train}, val=${counts.val}, test=${counts.test}`,
      '',
      'Isi berkas:',
      '- dataset.csv : text,label_id,label',
      '- manifest.csv : id,detection_id,source,gold_label,status,model_name,detection_method,image_found,file_found,verified_by,verified_at',
      '- images/<id>.<ext> : citra sumber bila file masih ada di ./uploads (tanpa fallback)',
      '- split.json : pembagian train/val/test + seed dan keyColumns',
      '',
    ].join('\n');
  }

  async estimateDownload(query: { status?: string; label?: string }) {
    const { rows, effectiveStatus } = await this.exportRows(query);
    const datasetCsv = this.buildExportCsv(rows);
    const { csv: manifestCsv, files } = this.buildManifestCsv(rows);
    const split = this.buildSplitJson(rows);
    const splitJson = JSON.stringify(split, null, 2);
    const readme = this.buildReadmeTxt({
      status: effectiveStatus,
      label: query.label ?? null,
      total: rows.length,
      counts: split.counts,
    });
    let imagesBytes = 0;
    let missing = 0;
    for (const f of files) {
      try {
        imagesBytes += statSync(f.diskPath).size;
      } catch {
        missing += 1;
      }
    }
    const parts = {
      datasetCsv: { bytes: Buffer.byteLength(datasetCsv, 'utf8'), rows: rows.length },
      manifestCsv: { bytes: Buffer.byteLength(manifestCsv, 'utf8'), rows: rows.length },
      images: { bytes: imagesBytes, count: files.length, missing },
      splitJson: { bytes: Buffer.byteLength(splitJson, 'utf8') },
      readmeTxt: { bytes: Buffer.byteLength(readme, 'utf8') },
    };
    const overheadPerFile = 128;
    const fileCount = 4 + files.length;
    const bytes =
      parts.datasetCsv.bytes +
      parts.manifestCsv.bytes +
      parts.images.bytes +
      parts.splitJson.bytes +
      parts.readmeTxt.bytes +
      fileCount * overheadPerFile;
    return { bytes, fileCount, breakdown: parts };
  }

  async downloadToResponse(query: { status?: string; label?: string }, res: Response, adminId?: number) {
    const { rows, effectiveStatus } = await this.exportRows(query);
    const datasetCsv = this.buildExportCsv(rows);
    const { csv: manifestCsv, files } = this.buildManifestCsv(rows);
    const split = this.buildSplitJson(rows);
    const splitJson = JSON.stringify(split, null, 2);
    const readme = this.buildReadmeTxt({
      status: effectiveStatus,
      label: query.label ?? null,
      total: rows.length,
      counts: split.counts,
    });

    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    const filename = `dataset_${ymd}_${rows.length}items.zip`;

    await this.audit('download', {
      status: effectiveStatus,
      label: query.label ?? null,
      count: rows.length,
      images: files.length,
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
    archive.append(datasetCsv, { name: 'dataset.csv' });
    archive.append(manifestCsv, { name: 'manifest.csv' });
    for (const f of files) {
      archive.file(f.diskPath, { name: f.entry });
    }
    archive.append(splitJson, { name: 'split.json' });
    archive.append(readme, { name: 'README.txt' });
    await archive.finalize();
  }
}
