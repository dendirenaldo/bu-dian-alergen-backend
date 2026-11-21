import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import type { Response } from 'express';
import { Op, fn, col } from 'sequelize';
import { DatasetItem } from './models/dataset-item.model';
import type { ValidationIssue } from './models/dataset-item.model';
import { Detection } from '../detections/models/detection.model';
import { DetectionAllergen } from '../detections/models/detection-allergen.model';
import { Allergen } from '../allergens/models/allergen.model';
import { Product } from '../products/models/product.model';
import { User } from '../users/models/user.model';
import { UpdateDatasetItemDto } from './dto/update-dataset-item.dto';
import { CreateDatasetItemDto } from './dto/create-dataset-item.dto';
import { DatasetQueryDto } from './dto/dataset-query.dto';
import { DatasetReviewDto, ReviewAction } from './dto/dataset-review.dto';
import { buildOrder } from '../../common/utils/sort-order';
import { csvEscape, labelToId } from './dataset.csv';
import {
  LeakageDSU,
  auditSplitDisjoint,
  normalizeSplitText,
  seededShuffle,
  textHash,
  type SplitAuditRow,
} from './dataset.split';
import {
  EXPORTABLE_STATUSES,
  canTransition,
  isDatasetStatus,
  type DatasetStatus,
} from './dataset.constants';
import {
  DatasetValidationService,
  datasetTextOf,
  normalizeAllergens,
  qualityFromIssues,
} from './dataset-validation.service';
import { readImageDimensions, safeStoredFilename, sha256Buffer } from '../../common/utils/image-meta';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync as existsSyncFs } from 'fs';

const DATASET_SORTABLE: Record<string, string> = {
  id: 'id',
  createdAt: 'createdAt',
  status: 'status',
  goldLabel: 'goldLabel',
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');

const GOLD_LABELS = ['safe', 'unsafe'] as const;

export { csvEscape, labelToId, csvRow } from './dataset.csv';
export {
  LeakageDSU,
  auditSplitDisjoint,
  normalizeSplitText,
  seededShuffle,
  textHash,
  buildConfiguredSplit,
} from './dataset.split';
export type { SplitAuditRow } from './dataset.split';

function httpError(
  status: number,
  message: string,
  code: string,
  errors: Array<{ field: string; message: string }> = [],
) {
  throw new HttpException({ statusCode: status, message, code, errors }, status);
}

/** Teks record: koreksi manusia diutamakan, fallback OCR mentah. */
export function datasetRowText(item: any): string {
  const t =
    item?.correctedText ??
    item?.corrected_text ??
    item?.ocrText ??
    item?.ocr_text ??
    '';
  return String(t ?? '');
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
    private readonly validationService: DatasetValidationService,
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

  private async knownAllergenSet(): Promise<Set<string>> {
    const rows = await this.allergenModel.findAll({ attributes: ['name'] });
    return new Set(rows.map((r: any) => String(r.name)));
  }

  /** Validasi nama alergen terhadap master allergens.name, throw 422 bila asing. */
  private async assertKnownAllergens(allergens: Array<{ name: string }>): Promise<void> {
    if (!Array.isArray(allergens) || allergens.length === 0) return;
    const names = [...new Set(allergens.map((a) => String(a?.name ?? '').trim()).filter(Boolean))];
    if (names.length === 0) return;
    const known = await this.knownAllergenSet();
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
      { model: User, as: 'verifier', required: false, attributes: ['id', 'name', 'email', 'role'] },
      { model: User, as: 'reviewer', required: false, attributes: ['id', 'name', 'email', 'role'] },
      { model: User, as: 'submitter', required: false, attributes: ['id', 'name', 'email', 'role'] },
    ];
  }

  private assertTransition(from: string, to: string) {
    if (!isDatasetStatus(to)) {
      httpError(HttpStatus.BAD_REQUEST, `Status tidak dikenal: ${to}`, 'INVALID_STATUS');
    }
    if (!canTransition(from, to)) {
      httpError(
        HttpStatus.CONFLICT,
        `Transisi status ${from} → ${to} tidak diizinkan`,
        'INVALID_STATUS_TRANSITION',
        [{ field: 'status', message: `Transisi ${from} → ${to} tidak diizinkan` }],
      );
    }
  }

  private async findDuplicateId(item: any): Promise<number | null> {
    const text = datasetTextOf(item).trim();
    if (!text) return null;
    const hash = textHash(text);
    // Kanonik = id terkecil dengan hash sama. Record pertama tidak menunjuk
    // ke record yang lebih baru (mencegah saling-duplikat).
    const row = await this.datasetModel.findOne({
      where: { duplicateHash: hash },
      attributes: ['id'],
      order: [['id', 'ASC']],
    });
    if (!row) return null;
    const canonicalId = Number((row as any).id);
    if (item?.id && Number(item.id) === canonicalId) return null;
    return canonicalId;
  }

  /**
   * Hitung validasi + kualitas + duplikat, tulis ke objek record.
   * Dipanggil sebelum simpan agar DB selalu berisi hasil validasi terbaru.
   */
  private async evaluateRecord(item: any, opts: { requireComplete?: boolean } = {}) {
    const known = await this.knownAllergenSet();
    const duplicateOf = await this.findDuplicateId(item);
    const issues = this.validationService.evaluate(item, {
      knownAllergens: known,
      duplicateOf,
      requireComplete: opts.requireComplete,
    }).issues;
    item.validationErrors = issues.length ? issues : null;
    item.qualityStatus = qualityFromIssues(issues);
    item.duplicateOf = duplicateOf;
    if (datasetTextOf(item).trim()) item.duplicateHash = textHash(datasetTextOf(item));
    return issues;
  }

  private async assertCompleteOrThrow(item: any, issues: ValidationIssue[]) {
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      httpError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Record belum valid: ${errors.map((e) => e.message).join(' ')}`,
        'VALIDATION_FAILED',
        errors.map((e) => ({ field: e.field, message: e.message })),
      );
    }
    void item;
  }

  private createValues(dto: CreateDatasetItemDto, adminId?: number) {
    const allergens = normalizeAllergens(dto.corrected_allergens);
    const ocr = dto.ocr_text?.trim() ?? null;
    const corrected = dto.corrected_text?.trim() ?? null;
    return {
      source: dto.source ?? 'manual',
      acquisitionSource: dto.acquisition_source ?? (dto.source === 'import' ? 'admin_import' : 'admin_manual'),
      acquisitionContext: dto.acquisition_context ?? null,
      sourceAppVersion: dto.source_app_version ?? null,
      productName: dto.product_name?.trim() || null,
      brand: dto.brand?.trim() || null,
      category: dto.category?.trim() || null,
      barcode: dto.barcode?.trim() || null,
      ocrText: ocr,
      correctedText: corrected,
      ingredientText: dto.ingredient_text?.trim() || null,
      normalizedIngredients: dto.normalized_ingredients?.length ? dto.normalized_ingredients : null,
      goldLabel: dto.gold_label ?? 'safe',
      correctedAllergens: allergens.length ? allergens : null,
      status: dto.status ?? 'draft',
      imageType: dto.image_type ?? null,
      ocrEngine: dto.ocr_engine ?? null,
      ocrEngineVersion: dto.ocr_engine_version ?? null,
      ocrStatus: dto.ocr_status ?? (ocr ? 'processed' : 'pending'),
      ocrProcessedAt: ocr ? new Date() : null,
      annotationSource: dto.annotation_source ?? (allergens.length ? 'human' : 'import'),
      annotationVersion: dto.annotation_version ?? '1',
      annotationSchemaVersion: dto.annotation_schema_version ?? '1.0.0',
      annotatorId: adminId ?? null,
      annotatedAt: new Date(),
      submittedBy: adminId ?? null,
      submittedAt: new Date(),
      notes: dto.notes ?? null,
      exportEligible: dto.export_eligible ?? true,
    } as any;
  }

  /** Admin membuat record dataset secara mandiri (tidak bergantung alur deteksi). */
  async create(dto: CreateDatasetItemDto, adminId?: number) {
    const values: any = this.createValues(dto, adminId);
    if (values.correctedAllergens?.length) {
      await this.assertKnownAllergens(values.correctedAllergens);
    }

    if (dto.detection_id) {
      const detection: any = await this.detectionModel.findByPk(dto.detection_id, {
        include: [{ model: DetectionAllergen, as: 'detectionAllergens', include: [{ model: Allergen, as: 'allergen' }] }],
      });
      if (!detection) {
        httpError(HttpStatus.NOT_FOUND, 'Deteksi tidak ditemukan', 'DETECTION_NOT_FOUND');
      }
      values.detectionId = detection.id;
      values.source = dto.source ?? 'detection';
      values.acquisitionSource = dto.acquisition_source ?? 'detection_promotion';
      values.ocrText = values.ocrText ?? detection.ocrText ?? null;
      values.goldLabel = dto.gold_label ?? detection.result ?? 'safe';
      values.imageUrl = values.imageUrl ?? detection.imageUrl ?? null;
      if (!values.correctedAllergens) {
        const rels: any[] = Array.isArray(detection.detectionAllergens) ? detection.detectionAllergens : [];
        const fromDetection = rels
          .map((r) => ({
            name: String(r?.allergen?.name ?? '').trim(),
            severity: (['low', 'medium', 'high', 'critical'] as string[]).includes(String(r?.allergen?.severityLevel))
              ? r.allergen.severityLevel
              : 'medium',
            confidence: Number(r?.confidenceScore ?? 0) || 0,
            presence: 'present',
          }))
          .filter((a) => a.name);
        values.correctedAllergens = fromDetection.length ? fromDetection : null;
        values.annotationSource = values.annotationSource === 'human' ? 'hybrid' : 'model';
      }
    }

    const targetStatus = String(values.status);
    const requireComplete = ['pending_review', 'verified', 'approved'].includes(targetStatus);
    const issues = await this.evaluateRecord(values, { requireComplete });
    if (!dto.allow_incomplete && requireComplete) await this.assertCompleteOrThrow(values, issues);

    const item = await this.datasetModel.create(values);
    await this.audit('create', { datasetId: (item as any).id, source: values.source, adminId: adminId ?? null });
    return this.findById((item as any).id);
  }

  /** Promosi deteksi lama → record dataset (idempoten). */
  async upsertFromDetection(detectionId: number, adminId?: number) {
    const detection: any = await this.detectionModel.findByPk(detectionId, {
      include: [{ model: DetectionAllergen, as: 'detectionAllergens', include: [{ model: Allergen, as: 'allergen' }] }],
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
        presence: 'present',
      }))
      .filter((a) => a.name);

    const values: any = {
      detectionId,
      source: 'detection',
      acquisitionSource: 'detection_promotion',
      ocrText: detection.ocrText ?? null,
      correctedText: null,
      ingredientText: null,
      goldLabel: detection.result,
      correctedAllergens: correctedAllergens.length ? correctedAllergens : null,
      status: 'draft',
      notes: null,
      imageUrl: detection.imageUrl ?? null,
      ocrStatus: detection.ocrText ? 'processed' : 'pending',
      annotationSource: 'model',
      annotationVersion: '1',
      annotationSchemaVersion: '1.0.0',
      submittedBy: adminId ?? null,
      submittedAt: new Date(),
      exportEligible: true,
    };
    await this.evaluateRecord(values, { requireComplete: false });

    const item = await this.datasetModel.create(values);
    await this.audit('upsert', { detectionId, datasetId: (item as any).id, adminId: adminId ?? null });
    return item;
  }

  /**
   * Kontribusi pengguna atas deteksi miliknya (atau promosi oleh admin).
   * Idempoten-ish: satu deteksi hanya boleh punya satu record dataset.
   * Status awal draft agar masuk antrean kurasi admin; pengguna tidak
   * dipaksa melengkapi anotasi.
   */
  async contributeFromDetection(
    detectionId: number,
    actor: { sub?: number; role?: string },
    dto: {
      corrected_text?: string;
      gold_label?: 'safe' | 'unsafe';
      corrected_allergens?: any[];
      notes?: string;
    },
  ) {
    const detection: any = await this.detectionModel.findByPk(detectionId, {
      include: [
        { model: Product, as: 'product', required: false },
        { model: DetectionAllergen, as: 'detectionAllergens', include: [{ model: Allergen, as: 'allergen' }] },
      ],
    });
    if (!detection) {
      httpError(HttpStatus.NOT_FOUND, 'Deteksi tidak ditemukan', 'DETECTION_NOT_FOUND');
    }
    const isAdmin = actor?.role === 'admin';
    if (!isAdmin && detection.userId !== actor?.sub) {
      httpError(HttpStatus.FORBIDDEN, 'Anda hanya dapat mengontribusikan deteksi milik sendiri', 'FORBIDDEN');
    }
    const existing = await this.datasetModel.findOne({ where: { detectionId }, attributes: ['id'] });
    if (existing) {
      httpError(
        HttpStatus.CONFLICT,
        'Deteksi ini sudah dikontribusikan ke dataset',
        'ALREADY_CONTRIBUTED',
        [{ field: 'detection_id', message: 'Sudah ada record dataset untuk deteksi ini' }],
      );
    }

    const provided = normalizeAllergens(dto.corrected_allergens);
    if (provided.length) await this.assertKnownAllergens(provided);
    const rels: any[] = Array.isArray(detection.detectionAllergens) ? detection.detectionAllergens : [];
    const modelAllergens = rels
      .map((r) => ({
        name: String(r?.allergen?.name ?? '').trim(),
        severity: (['low', 'medium', 'high', 'critical'] as string[]).includes(String(r?.allergen?.severityLevel))
          ? r.allergen.severityLevel
          : 'medium',
        confidence: Number(r?.confidenceScore ?? 0) || 0,
        presence: 'present',
      }))
      .filter((a) => a.name);

    const values: any = {
      detectionId,
      source: isAdmin ? 'detection' : 'user_submission',
      acquisitionSource: isAdmin ? 'detection_promotion' : 'user_scan',
      acquisitionContext: isAdmin ? null : 'post_detection_feedback',
      productName: detection.product?.name ?? null,
      brand: detection.product?.brand ?? null,
      category: detection.product?.category?.name ?? null,
      ocrText: detection.ocrText ?? null,
      correctedText: dto.corrected_text?.trim() || detection.ocrText || null,
      goldLabel: dto.gold_label ?? detection.result ?? 'safe',
      correctedAllergens: provided.length ? provided : modelAllergens.length ? modelAllergens : null,
      status: 'draft',
      notes: dto.notes?.trim() || null,
      imageUrl: detection.imageUrl ?? null,
      imageType: 'ingredient_label',
      ocrStatus: detection.ocrText ? 'processed' : 'pending',
      ocrProcessedAt: detection.ocrText ? new Date() : null,
      annotationSource: provided.length ? 'hybrid' : 'model',
      annotationVersion: '1',
      annotationSchemaVersion: '1.0.0',
      annotatorId: actor?.sub ?? null,
      annotatedAt: new Date(),
      submittedBy: actor?.sub ?? null,
      submittedAt: new Date(),
      exportEligible: true,
    };
    await this.evaluateRecord(values, { requireComplete: false });
    const item = await this.datasetModel.create(values);
    await this.audit('contribute', {
      detectionId,
      datasetId: (item as any).id,
      actorId: actor?.sub ?? null,
      source: values.source,
    });
    return this.findById((item as any).id);
  }

  async findAll(query: DatasetQueryDto) {
    const safePage = Number.isFinite(+query.page!) && +query.page! > 0 ? Math.floor(+query.page!) : 1;
    const safeLimit =
      Number.isFinite(+query.limit!) && +query.limit! > 0 ? Math.min(Math.floor(+query.limit!), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const where: any = {};

    if (query.status) {
      const list = String(query.status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      where.status = list.length > 1 ? { [Op.in]: list } : list[0];
    }
    if (query.label === 'safe' || query.label === 'unsafe') where.goldLabel = query.label;
    if (query.source) where.source = query.source;
    if (query.acquisitionSource) where.acquisitionSource = query.acquisitionSource;
    if (query.category) where.category = query.category;
    if (query.ocrStatus) where.ocrStatus = query.ocrStatus;
    if (query.quality) where.qualityStatus = query.quality;
    if (query.duplicate === true) where.duplicateOf = { [Op.ne]: null };
    if (query.duplicate === false) where.duplicateOf = null;
    if (query.exportEligible !== undefined) where.exportEligible = query.exportEligible;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt[Op.gte] = new Date(query.from);
      if (query.to) where.createdAt[Op.lte] = new Date(query.to);
    }
    if (query.allergen && String(query.allergen).trim()) {
      // JSON disimpan sebagai TEXT di MariaDB/SQLite; LIKE cukup untuk filter
      // nama alergen dan tetap kompatibel lintas dialek (tanpa JSON_SEARCH).
      where.correctedAllergens = { [Op.like]: `%${this.escapeLike(String(query.allergen).trim())}%` };
    }
    if (query.search && String(query.search).trim()) {
      const raw = String(query.search).trim().slice(0, 100);
      const like = { [Op.like]: `%${this.escapeLike(raw)}%` };
      where[Op.or] = [
        { correctedText: like },
        { ocrText: like },
        { productName: like },
        { brand: like },
        { category: like },
      ];
    }

    const { rows, count } = await this.datasetModel.findAndCountAll({
      where,
      include: this.datasetInclude(),
      offset,
      limit: safeLimit,
      order: buildOrder(query.sortBy, query.sortDir, DATASET_SORTABLE, [['createdAt', 'DESC']]),
      distinct: true,
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
      item.correctedAllergens = normalizeAllergens(dto.corrected_allergens ?? []);
      item.annotationSource = item.annotationSource ?? 'human';
      item.annotatorId = adminId ?? item.annotatorId ?? null;
      item.annotatedAt = new Date();
    }
    if (dto.corrected_text !== undefined) {
      item.correctedText = dto.corrected_text;
      if (item.ocrText) item.ocrStatus = 'corrected';
    }
    if (dto.ocr_text !== undefined) {
      item.ocrText = dto.ocr_text;
      item.ocrProcessedAt = new Date();
      item.ocrStatus = item.ocrStatus ?? 'processed';
    }
    if (dto.gold_label !== undefined) {
      if (!(GOLD_LABELS as readonly string[]).includes(dto.gold_label)) {
        httpError(HttpStatus.BAD_REQUEST, 'gold_label harus safe atau unsafe', 'INVALID_GOLD_LABEL', []);
      }
      item.goldLabel = dto.gold_label;
    }
    if (dto.product_name !== undefined) item.productName = dto.product_name?.trim() || null;
    if (dto.brand !== undefined) item.brand = dto.brand?.trim() || null;
    if (dto.category !== undefined) item.category = dto.category?.trim() || null;
    if (dto.barcode !== undefined) item.barcode = dto.barcode?.trim() || null;
    if (dto.ingredient_text !== undefined) item.ingredientText = dto.ingredient_text?.trim() || null;
    if (dto.normalized_ingredients !== undefined) {
      item.normalizedIngredients = dto.normalized_ingredients?.length ? dto.normalized_ingredients : null;
    }
    if (dto.image_type !== undefined) item.imageType = dto.image_type;
    if (dto.ocr_engine !== undefined) item.ocrEngine = dto.ocr_engine;
    if (dto.ocr_engine_version !== undefined) item.ocrEngineVersion = dto.ocr_engine_version;
    if (dto.ocr_status !== undefined) item.ocrStatus = dto.ocr_status;
    if (dto.export_eligible !== undefined) item.exportEligible = dto.export_eligible;
    if (dto.review_note !== undefined) item.reviewNote = dto.review_note;
    if (dto.notes !== undefined) item.notes = dto.notes;

    if (dto.status !== undefined) {
      this.assertTransition(String(item.status), dto.status);
      item.status = dto.status;
      const now = new Date();
      if (dto.status === 'verified' || dto.status === 'approved') {
        item.verifiedBy = adminId ?? item.verifiedBy ?? null;
        item.verifiedAt = item.verifiedAt ?? now;
        item.reviewedBy = adminId ?? item.reviewedBy ?? null;
        item.reviewedAt = now;
      } else if (dto.status === 'rejected' || dto.status === 'needs_correction') {
        item.reviewedBy = adminId ?? item.reviewedBy ?? null;
        item.reviewedAt = now;
        item.verifiedBy = null;
        item.verifiedAt = null;
      } else if (dto.status === 'draft' || dto.status === 'archived') {
        item.verifiedBy = null;
        item.verifiedAt = null;
      }
    }

    const targetStatus = String(item.status);
    const requireComplete = ['pending_review', 'verified', 'approved'].includes(targetStatus);
    const issues = await this.evaluateRecord(item, { requireComplete });
    if (requireComplete) await this.assertCompleteOrThrow(item, issues);

    await item.save();
    await this.audit('update', { datasetId: id, status: item.status, adminId: adminId ?? null });
    return this.findById(id);
  }

  /** Workflow review: aksi → transisi status terpusat. */
  async review(id: number, dto: DatasetReviewDto, adminId?: number) {
    const target: Record<ReviewAction, string> = {
      submit: 'pending_review',
      verify: 'verified',
      approve: 'approved',
      reject: 'rejected',
      request_correction: 'needs_correction',
      unverify: 'needs_correction',
      archive: 'archived',
      restore: 'draft',
    };
    if ((dto.action === 'reject' || dto.action === 'request_correction') && !dto.note?.trim()) {
      httpError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Catatan reviewer wajib diisi untuk aksi ini',
        'REVIEW_NOTE_REQUIRED',
        [{ field: 'note', message: 'Catatan reviewer wajib diisi' }],
      );
    }
    const result = await this.update(
      id,
      { status: target[dto.action], review_note: dto.note ?? undefined } as UpdateDatasetItemDto,
      adminId,
    );
    await this.audit('review', { datasetId: id, action: dto.action, adminId: adminId ?? null });
    return result;
  }

  async remove(id: number, adminId?: number) {
    const item: any = await this.findById(id);
    const url = item.imageUrl ?? item.image_url ?? null;
    await item.destroy();
    if (url) {
      try {
        const abs = join(process.cwd(), 'uploads', basename(String(url)));
        if (existsSyncFs(abs)) await unlink(abs);
      } catch {
        /* gagal hapus berkas bukan alasan menggagalkan hapus record */
      }
    }
    await this.audit('remove', { datasetId: id, adminId: adminId ?? null });
    return { message: 'Dataset item dihapus' };
  }

  async markVerified(id: number, adminId?: number) {
    return this.review(id, { action: 'verify' }, adminId);
  }

  async unmarkVerified(id: number, adminId?: number) {
    return this.review(id, { action: 'unverify', note: 'Diverifikasi ulang diperlukan' }, adminId);
  }

  /** Unggah/ ganti gambar record dataset dengan validasi & checksum. */
  async uploadImage(
    id: number,
    file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
    adminId?: number,
    imageType?: string,
  ) {
    const item: any = await this.findById(id);
    if (!file?.buffer?.length) {
      httpError(HttpStatus.BAD_REQUEST, 'Berkas gambar wajib diunggah', 'FILE_REQUIRED');
    }
    const mime = String(file.mimetype ?? '');
    if (!mime.startsWith('image/')) {
      httpError(HttpStatus.BAD_REQUEST, `Tipe berkas tidak didukung: ${mime || 'tanpa tipe'}`, 'INVALID_IMAGE_MIME');
    }
    if (file.buffer.length > 5 * 1024 * 1024) {
      httpError(HttpStatus.PAYLOAD_TOO_LARGE, 'Ukuran gambar maksimal 5 MB', 'IMAGE_TOO_LARGE');
    }
    const extMatch = String(file.originalname ?? '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
    if (!extMatch || !allowed.includes(extMatch)) {
      httpError(HttpStatus.BAD_REQUEST, 'Ekstensi gambar harus JPG/PNG/WEBP/GIF/BMP', 'INVALID_IMAGE_EXT');
    }
    const ext = extMatch === 'jpeg' ? 'jpg' : extMatch;
    const checksum = sha256Buffer(file.buffer);
    const dims = readImageDimensions(file.buffer);
    const stored = safeStoredFilename(`ds${id}`, file.originalname, mime, ext);
    const uploadsDir = join(process.cwd(), 'uploads');
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, stored), file.buffer);

    item.imageUrl = `/uploads/${stored}`;
    item.storedFilename = stored;
    item.originalFilename = String(file.originalname ?? '').slice(0, 255);
    item.imageMime = mime;
    item.imageSize = file.buffer.length;
    item.imageWidth = dims?.width ?? null;
    item.imageHeight = dims?.height ?? null;
    item.imageChecksum = checksum;
    item.imageType = imageType ?? item.imageType ?? 'ingredient_label';

    const issues = await this.evaluateRecord(item, {
      requireComplete: ['pending_review', 'verified', 'approved'].includes(String(item.status)),
    });
    void issues;
    await item.save();
    await this.audit('image.upload', { datasetId: id, checksum, adminId: adminId ?? null });
    return this.findById(id);
  }

  /**
   * Statistik operasional untuk dashboard dataset.
   * Agregasi status/label/kualitas memakai GROUP BY; distribusi alergen &
   * tren harian dihitung dari kolom minimal (id, alergen, createdAt) agar
   * tidak memuat seluruh record + relasi ke memori.
   */
  async statistics() {
    const groupCount = async (field: string) => {
      const rows: any[] = await this.datasetModel.findAll({
        attributes: [field, [fn('COUNT', col('id')), 'count']],
        group: [field],
        raw: true,
      });
      const out: Record<string, number> = {};
      for (const r of rows) {
        const key = String((r as any)[field] ?? 'unknown');
        out[key] = Number((r as any).count ?? 0);
      }
      return out;
    };

    const [statusCounts, qualityCounts, labelCounts, sourceCounts, acquisitionCounts] = await Promise.all([
      groupCount('status'),
      groupCount('qualityStatus'),
      groupCount('goldLabel'),
      groupCount('source'),
      groupCount('acquisitionSource'),
    ]);

    const minimal: any[] = await this.datasetModel.findAll({
      attributes: ['id', 'correctedAllergens', 'createdAt', 'imageUrl', 'ocrText', 'correctedText', 'duplicateOf', 'exportEligible', 'ocrStatus', 'status'],
      raw: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const parseJsonArray = require('../../common/utils/json-field').parseJsonArray as (
      raw: unknown,
      fallback: any[],
    ) => any[];
    const allergenMap = new Map<string, number>();
    const growthMap = new Map<string, number>();
    let missingImage = 0;
    let missingText = 0;
    let duplicates = 0;
    let ocrFailed = 0;
    let exportable = 0;
    const now = new Date();
    for (const r of minimal) {
      const list = parseJsonArray(r.correctedAllergens ?? r.corrected_allergens, []);
      for (const a of list) {
        const name = String(a?.name ?? '').trim();
        if (name) allergenMap.set(name, (allergenMap.get(name) ?? 0) + 1);
      }
      if (!r.imageUrl) missingImage += 1;
      if (!String(r.correctedText ?? r.ocrText ?? '').trim()) missingText += 1;
      if (r.duplicateOf) duplicates += 1;
      if (r.ocrStatus === 'failed') ocrFailed += 1;
      if (r.exportEligible && (EXPORTABLE_STATUSES as string[]).includes(String(r.status)) && String(r.correctedText ?? r.ocrText ?? '').trim()) {
        exportable += 1;
      }
      const created = r.createdAt ? new Date(r.createdAt) : null;
      if (created && now.getTime() - created.getTime() <= 14 * 24 * 3600 * 1000) {
        const key = created.toISOString().slice(0, 10);
        growthMap.set(key, (growthMap.get(key) ?? 0) + 1);
      }
    }

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const allergenDistribution = [...allergenMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 25);
    const growth: Array<{ date: string; count: number }> = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      growth.push({ date: key, count: growthMap.get(key) ?? 0 });
    }

    return {
      totals: {
        total,
        awaitingReview: statusCounts.pending_review ?? 0,
        needsCorrection: statusCounts.needs_correction ?? 0,
        verified: statusCounts.verified ?? 0,
        approved: statusCounts.approved ?? 0,
        rejected: statusCounts.rejected ?? 0,
        draft: statusCounts.draft ?? 0,
        archived: statusCounts.archived ?? 0,
        exportable,
        missingImage,
        missingText,
        duplicates,
        ocrFailed,
        qualityError: qualityCounts.error ?? 0,
        qualityWarning: qualityCounts.warning ?? 0,
        qualityOk: qualityCounts.ok ?? 0,
      },
      statusCounts,
      qualityCounts,
      labelCounts,
      sourceCounts,
      acquisitionCounts,
      allergenDistribution,
      growth,
      generatedAt: new Date().toISOString(),
    };
  }

/** Filter export/unduh: default HANYA verified; draft ikut hanya bila ?status=draft eksplisit. */
  private exportWhere(query: { status?: string; label?: string }) {
    const where: any = {};
    if (query.status === 'draft' || query.status === 'verified') {
      where.status = query.status;
    } else {
      // Kompatibel dengan workflow baru: default menyertakan approved.
      where.status = { [Op.in]: [...EXPORTABLE_STATUSES] };
    }
    if (query.label === 'safe' || query.label === 'unsafe') where.goldLabel = query.label;
    const effectiveStatus = Array.isArray(where.status)
      ? where.status.join(',')
      : typeof where.status === 'object'
        ? [...EXPORTABLE_STATUSES].join(',')
        : String(where.status);
    return { where, effectiveStatus };
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
      'Dataset Ekspor Alergen (Allergen Detector)',
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
