import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Op } from 'sequelize';
import type { CreateDatasetExportDto } from './dto/dataset-export.dto';
import { DatasetItem } from './models/dataset-item.model';
import { DatasetExport, type ExportWarning } from './models/dataset-export.model';
import { Detection } from '../detections/models/detection.model';
import {
  DATASET_EXPORT_SCHEMA_VERSION,
  DEFAULT_PROFILE_FORMAT,
  EXPORTABLE_STATUSES,
  EXPORT_FORMATS,
  EXPORT_PROFILES,
  type ExportFormat,
  type ExportProfile,
  safeImageExt,
} from './dataset.constants';
import {
  allergenLabelSet,
  allergensOf,
  computeValidationIssues,
  datasetOcrTextOf,
  datasetTextOf,
  positiveAllergens,
  slugify,
} from './dataset-validation.service';
import { buildConfiguredSplit, textHash, type ConfiguredSplitResult } from './dataset.split';
import { csvRow, labelToId } from './dataset.csv';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');

function httpError(
  status: number,
  message: string,
  code: string,
  errors: Array<{ field: string; message: string }> = [],
) {
  throw new HttpException({ statusCode: status, message, code, errors }, status);
}

function uploadsDir(): string {
  return join(process.cwd(), 'uploads');
}

function exportsDir(): string {
  return join(uploadsDir(), 'exports');
}

function recordIdOf(id: number): string {
  return `ds_${String(id).padStart(6, '0')}`;
}

interface PreparedImage {
  abs: string;
  rel: string;
  ext: string;
  bytes: number;
}

interface PreparedRow {
  item: any;
  recordId: string;
  image: PreparedImage | null;
  text: string;
  ocrText: string;
  ingredients: string[];
  allergens: ReturnType<typeof allergensOf>;
  labels: string[];
  groupKey: string;
  textHash: string;
  split?: 'train' | 'validation' | 'test';
}

interface FileEntry {
  path: string;
  content?: string | Buffer;
  srcPath?: string;
  bytes: number;
  sha256: string;
}

export interface ExportPreview {
  profile: ExportProfile;
  format: ExportFormat;
  filters: Record<string, unknown>;
  counts: {
    selected: number;
    eligible: number;
    excluded: number;
    images: number;
    missingImages: number;
    labels: { safe: number; unsafe: number };
  };
  labelDistribution: Record<string, number>;
  allergenDistribution: Array<{ name: string; count: number }>;
  split: ConfiguredSplitResult | null;
  excluded: Array<{ id: number; reason: string }>;
  warnings: ExportWarning[];
  integrity: {
    duplicateIds: number;
    missingImages: number;
    validationErrors: number;
    validationWarnings: number;
    auditPassed: boolean;
    missingText: number;
  };
  estimatedBytes: number;
}

@Injectable()
export class DatasetExportService {
  private readonly logger = new Logger(DatasetExportService.name);

  constructor(
    @InjectModel(DatasetItem)
    private readonly datasetModel: typeof DatasetItem,
    @InjectModel(DatasetExport)
    private readonly exportModel: typeof DatasetExport,
    @Optional()
    @Inject('AUDIT_LOG_SERVICE')
    private readonly auditLogService?: {
      log?: (action: string, meta?: Record<string, unknown>) => Promise<void> | void;
    },
  ) {}

  private async audit(action: string, meta: Record<string, unknown> = {}) {
    try {
      await this.auditLogService?.log?.(`dataset.export.${action}`, meta);
    } catch (e) {
      this.logger.warn(`Audit export gagal: ${(e as any)?.message}`);
    }
  }

  private normalizeConfig(dto: CreateDatasetExportDto) {
    const profile = (EXPORT_PROFILES as readonly string[]).includes(String(dto.profile))
      ? (dto.profile as ExportProfile)
      : 'nlp';
    const format = (EXPORT_FORMATS as readonly string[]).includes(String(dto.format))
      ? (dto.format as ExportFormat)
      : DEFAULT_PROFILE_FORMAT[profile];
    const statuses = (dto.status ?? EXPORTABLE_STATUSES.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ratios = {
      train: dto.trainRatio ?? 0.7,
      validation: dto.validationRatio ?? 0.15,
      test: dto.testRatio ?? 0.15,
    };
    const sum = ratios.train + ratios.validation + ratios.test;
    if (profile === 'image_classification' && dto.includeImages === false) {
      httpError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Profil image_classification memerlukan gambar; aktifkan includeImages.',
        'PROFILE_REQUIRES_IMAGES',
        [{ field: 'includeImages', message: 'Profil gambar tidak dapat diekspor tanpa gambar' }],
      );
    }
    if (!(sum > 0.999 && sum < 1.001)) {
      httpError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Total rasio train/validation/test harus 1.0',
        'INVALID_SPLIT_RATIOS',
        [{ field: 'trainRatio', message: `Total rasio saat ini ${sum.toFixed(3)}` }],
      );
    }
    return {
      profile,
      format,
      statuses,
      label: dto.label,
      search: dto.search?.trim() || undefined,
      ids: dto.ids?.length ? dto.ids : undefined,
      includeImages: dto.includeImages ?? true,
      includeSplits: dto.includeSplits ?? true,
      includeSchema: dto.includeSchema ?? true,
      seed: Number.isFinite(Number(dto.seed)) ? Number(dto.seed) : 42,
      ratios,
      groupBy: dto.groupBy ?? 'detection',
      strategy: dto.strategy ?? 'multilabel',
      maxRecords: Number.isFinite(Number(dto.maxRecords)) ? Number(dto.maxRecords) : 5000,
    };
  }

  private async loadRows(cfg: ReturnType<DatasetExportService['normalizeConfig']>): Promise<any[]> {
    const where: any = { status: { [Op.in]: cfg.statuses } };
    if (cfg.label) where.goldLabel = cfg.label;
    if (cfg.ids) where.id = { [Op.in]: cfg.ids };
    if (cfg.search) {
      const like = { [Op.like]: `%${cfg.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` };
      where[Op.or] = [{ correctedText: like }, { ocrText: like }, { productName: like }, { brand: like }];
    }
    const rows: any[] = await this.datasetModel.findAll({
      where,
      include: [
        {
          model: Detection,
          as: 'detection',
          required: false,
          attributes: ['id', 'imageUrl', 'modelName', 'detectionMethod'],
        },
      ],
      order: [['id', 'ASC']],
    });
    if (rows.length > cfg.maxRecords) {
      httpError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        `Ekspor dibatasi ${cfg.maxRecords} record; seleksi saat ini ${rows.length}. Persempit filter atau naikkan maxRecords.`,
        'EXPORT_LIMIT_EXCEEDED',
        [{ field: 'maxRecords', message: `Terlalu banyak record: ${rows.length}` }],
      );
    }
    return rows;
  }

  private resolveImage(item: any): PreparedImage | null {
    const raw = item?.imageUrl ?? item?.image_url ?? item?.detection?.imageUrl ?? null;
    if (!raw) return null;
    // basename() menetralkan path traversal; nama tersimpan tidak pernah
    // diambil langsung dari klien.
    const stored = basename(String(raw));
    if (!stored || stored === '.' || stored === '..') return null;
    const abs = join(uploadsDir(), stored);
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) return null;
    } catch {
      return null;
    }
    const ext = safeImageExt(stored, item?.imageMime ?? item?.image_mime);
    return { abs, rel: stored, ext, bytes: statSync(abs).size };
  }

  private async prepare(dto: CreateDatasetExportDto): Promise<{
    cfg: ReturnType<DatasetExportService['normalizeConfig']>;
    selected: number;
    rows: PreparedRow[];
    excluded: Array<{ id: number; reason: string }>;
    warnings: ExportWarning[];
    split: ConfiguredSplitResult | null;
    labelDistribution: Record<string, number>;
    allergenDistribution: Array<{ name: string; count: number }>;
    validationErrors: number;
    validationWarnings: number;
    missingText: number;
  }> {
    const cfg = this.normalizeConfig(dto);
    const all = await this.loadRows(cfg);
    const excluded: Array<{ id: number; reason: string }> = [];
    const warnings: ExportWarning[] = [];
    const prepared: PreparedRow[] = [];
    const allergenCounts = new Map<string, number>();
    const labelDistribution: Record<string, number> = { safe: 0, unsafe: 0 };
    let validationErrors = 0;
    let validationWarnings = 0;
    let missingText = 0;

    for (const item of all) {
      if (item.exportEligible === false) {
        excluded.push({ id: item.id, reason: 'export_eligible=false' });
        continue;
      }
      const text = datasetTextOf(item).trim();
      const image = this.resolveImage(item);
      if (!text) missingText += 1;
      if (!text && cfg.profile !== 'raw') {
        excluded.push({ id: item.id, reason: 'empty_text' });
        continue;
      }
      if (!image && cfg.includeImages && cfg.profile === 'image_classification') {
        excluded.push({ id: item.id, reason: 'missing_image' });
        continue;
      }
      if (!text && !image) {
        excluded.push({ id: item.id, reason: 'no_text_and_no_image' });
        continue;
      }
      const issues = computeValidationIssues(item, { requireComplete: true });
      validationErrors += issues.filter((i) => i.severity === 'error').length;
      validationWarnings += issues.filter((i) => i.severity === 'warning').length;
      for (const i of issues) {
        if (i.severity === 'error' && !warnings.some((w) => w.code === i.code)) {
          warnings.push({ code: i.code, message: i.message });
        }
      }
      const allergens = allergensOf(item);
      for (const a of positiveAllergens(item)) {
        allergenCounts.set(a.name, (allergenCounts.get(a.name) ?? 0) + 1);
      }
      const gold = String(item.goldLabel ?? 'safe');
      labelDistribution[gold] = (labelDistribution[gold] ?? 0) + 1;
      const ingredients = Array.isArray(item.normalizedIngredients)
        ? item.normalizedIngredients.map((s: any) => String(s))
        : String(item.ingredientText ?? '')
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean);
      const detId = item.detectionId ?? item.detection_id ?? null;
      prepared.push({
        item,
        recordId: recordIdOf(item.id),
        image,
        text,
        ocrText: datasetOcrTextOf(item),
        ingredients,
        allergens,
        labels: allergenLabelSet(item),
        groupKey: detId != null ? `d:${detId}` : `i:${item.id}`,
        textHash: text ? textHash(text) : '',
      });
    }

    let split: ConfiguredSplitResult | null = null;
    if (prepared.length > 0) {
      split = buildConfiguredSplit(
        prepared.map((r) => ({
          id: r.item.id,
          groupKey: r.groupKey,
          textHash: r.textHash,
          labels: r.labels,
        })),
        {
          seed: cfg.seed,
          ratios: cfg.ratios,
          strategy: cfg.strategy,
          groupBy: cfg.groupBy,
        },
      );
      const bucketOf = new Map<number, 'train' | 'validation' | 'test'>();
      for (const b of ['train', 'validation', 'test'] as const) {
        for (const id of split.splits[b]) bucketOf.set(id, b);
      }
      for (const r of prepared) r.split = bucketOf.get(r.item.id);
    }

    const missingImages = prepared.filter((r) => !r.image).length;
    if (missingImages > 0) {
      warnings.push({
        code: 'MISSING_IMAGES',
        message: `${missingImages} record tidak memiliki berkas gambar di storage.`,
        recordIds: prepared.filter((r) => !r.image).map((r) => r.item.id).slice(0, 100),
      });
    }

    return {
      cfg,
      selected: all.length,
      rows: prepared,
      excluded,
      warnings,
      split,
      labelDistribution,
      allergenDistribution: [...allergenCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      validationErrors,
      validationWarnings,
      missingText,
    };
  }

  private estimatedBytes(rows: PreparedRow[], profile: ExportProfile, includeImages = true): number {
    let bytes = 4096;
    for (const r of rows) {
      bytes += Buffer.byteLength(r.text, 'utf8') + 512;
      if (r.image && includeImages && profile !== 'nlp') bytes += r.image.bytes;
    }
    return bytes;
  }

  async preview(dto: CreateDatasetExportDto): Promise<ExportPreview> {
    const p = await this.prepare(dto);
    const labelDistribution: Record<string, number> = { ...p.labelDistribution };
    for (const a of p.allergenDistribution) labelDistribution[`allergen_${slugify(a.name)}`] = a.count;
    return {
      profile: p.cfg.profile,
      format: p.cfg.format,
      filters: {
        status: p.cfg.statuses,
        label: p.cfg.label ?? null,
        search: p.cfg.search ?? null,
        ids: p.cfg.ids?.length ?? 0,
      },
      counts: {
        selected: p.selected,
        eligible: p.rows.length,
        excluded: p.excluded.length,
        images: p.rows.filter((r) => r.image).length,
        missingImages: p.rows.filter((r) => !r.image).length,
        labels: {
          safe: p.labelDistribution.safe ?? 0,
          unsafe: p.labelDistribution.unsafe ?? 0,
        },
      },
      labelDistribution,
      allergenDistribution: p.allergenDistribution,
      split: p.split,
      excluded: p.excluded,
      warnings: p.warnings,
      integrity: {
        duplicateIds: 0,
        missingImages: p.rows.filter((r) => !r.image).length,
        validationErrors: p.validationErrors,
        validationWarnings: p.validationWarnings,
        auditPassed: p.split ? p.split.audit.every((a) => a.status === 'PASS') : true,
        missingText: p.missingText,
      },
      estimatedBytes: this.estimatedBytes(p.rows, p.cfg.profile, p.cfg.includeImages),
    };
  }

  private serializeRecord(
    r: PreparedRow,
    splitName?: string,
    opts: { includeImages?: boolean; imageDir?: string } = {},
  ) {
    const item = r.item;
    const det = item.detection ?? null;
    return {
      record_id: r.recordId,
      dataset_item_id: item.id,
      detection_id: item.detectionId ?? item.detection_id ?? null,
      product: {
        name: item.productName ?? det?.product?.name ?? null,
        brand: item.brand ?? det?.product?.brand ?? null,
        category: item.category ?? det?.product?.category?.name ?? null,
        barcode: item.barcode ?? null,
      },
      image: r.image && opts.includeImages !== false
        ? {
            path: `images/original/${r.recordId}.${r.image.ext}`,
            type: item.imageType ?? null,
            mime: item.imageMime ?? null,
            width: item.imageWidth ?? null,
            height: item.imageHeight ?? null,
            bytes: r.image.bytes,
            sha256: item.imageChecksum ?? null,
          }
        : null,
      text: {
        raw_ocr: r.ocrText,
        corrected: String(item.correctedText ?? '').trim() || null,
        // Teks utama yang dipakai model: koreksi manusia > OCR mentah.
        value: r.text,
        ingredients: r.ingredients,
        ingredient_text: item.ingredientText ?? null,
      },
      label: {
        gold: String(item.goldLabel ?? 'safe'),
        label_id: labelToId(String(item.goldLabel ?? 'safe')),
        multilabel: r.labels,
      },
      allergens: r.allergens.map((a) => ({
        name: a.name,
        label: `allergen_${slugify(a.name)}`,
        severity: a.severity,
        confidence: a.confidence,
        presence: a.presence ?? 'present',
        evidence: a.evidence ?? null,
      })),
      acquisition: {
        source: item.source ?? null,
        acquisition_source: item.acquisitionSource ?? null,
        context: item.acquisitionContext ?? null,
        submitted_by: item.submittedBy ?? null,
        submitted_at: item.submittedAt ?? null,
        source_app_version: item.sourceAppVersion ?? null,
      },
      annotation: {
        source: item.annotationSource ?? null,
        version: item.annotationVersion ?? null,
        schema_version: item.annotationSchemaVersion ?? null,
        annotator_id: item.annotatorId ?? null,
        annotated_at: item.annotatedAt ?? null,
        status: item.status,
        quality: item.qualityStatus,
        reviewed_by: item.reviewedBy ?? null,
        reviewed_at: item.reviewedAt ?? null,
        verified_by: item.verifiedBy ?? null,
        verified_at: item.verifiedAt ?? null,
      },
      provenance: {
        ocr_engine: item.ocrEngine ?? null,
        ocr_engine_version: item.ocrEngineVersion ?? null,
        ocr_status: item.ocrStatus ?? null,
        ocr_processed_at: item.ocrProcessedAt ?? null,
        created_at: item.createdAt ?? null,
        updated_at: item.updatedAt ?? null,
      },
      split: splitName ?? r.split ?? null,
    };
  }

  private recordTextFor(r: PreparedRow) {
    return r.text.replace(/\s*\r?\n\s*/g, ' ').trim();
  }

  private serializeRecords(
    rows: PreparedRow[],
    format: ExportFormat,
    opts: { includeImages?: boolean; imageDir?: string } = {},
  ): string {
    const objs = rows.map((r) => this.serializeRecord(r, undefined, opts));
    if (format === 'json') return JSON.stringify(objs, null, 2);
    if (format === 'jsonl') return objs.map((o) => JSON.stringify(o)).join('\n') + (objs.length ? '\n' : '');
    const header = 'record_id,dataset_item_id,text,label,label_id,allergens,product_name,brand,category,image_path,split';
    const lines = [header];
    for (const r of rows) {
      const o = this.serializeRecord(r, undefined, opts);
      lines.push(
        csvRow([
          o.record_id,
          r.item.id,
          this.recordTextFor(r),
          o.label.gold,
          o.label.label_id,
          r.allergens.map((a) => a.name).join('|'),
          o.product.name ?? '',
          o.product.brand ?? '',
          o.product.category ?? '',
          r.image && opts.includeImages !== false ? `${opts.imageDir ?? 'images/original'}/${r.recordId}.${r.image.ext}` : '',
          o.split ?? '',
        ]),
      );
    }
    return lines.join('\n') + '\n';
  }

  private labelsCsv(rows: PreparedRow[], withSplit: boolean): string {
    const allergenSlugs = [...new Set(rows.flatMap((r) => r.allergens.map((a) => slugify(a.name))))].sort();
    const header = [
      'record_id',
      'dataset_item_id',
      'file_name',
      'label',
      'label_id',
      ...allergenSlugs.map((s) => `allergen_${s}`),
      ...(withSplit ? ['split'] : []),
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      const present = new Set(positiveAllergens(r.item).map((a) => slugify(a.name)));
      const file = r.image ? `${r.recordId}.${r.image.ext}` : '';
      const gold = String(r.item.goldLabel ?? 'safe');
      lines.push(
        csvRow([
          r.recordId,
          r.item.id,
          file,
          gold,
          labelToId(gold),
          ...allergenSlugs.map((s) => (present.has(s) ? 1 : 0)),
          ...(withSplit ? [r.split ?? ''] : []),
        ]),
      );
    }
    return lines.join('\n') + '\n';
  }

  private splitRows(rows: PreparedRow[], split: 'train' | 'validation' | 'test'): PreparedRow[] {
    return rows.filter((r) => r.split === split);
  }

  private recordSchema() {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://allergen-detector.local/schema/record.schema.json',
      title: 'Allergen dataset record',
      type: 'object',
      required: ['record_id', 'dataset_item_id', 'text', 'label', 'allergens'],
      properties: {
        record_id: { type: 'string', pattern: '^ds_[0-9]{6,}$' },
        dataset_item_id: { type: 'integer' },
        detection_id: { type: ['integer', 'null'] },
        product: {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'] },
            brand: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
            barcode: { type: ['string', 'null'] },
          },
        },
        image: {
          type: ['object', 'null'],
          properties: {
            path: { type: 'string' },
            type: { type: ['string', 'null'] },
            mime: { type: ['string', 'null'] },
            width: { type: ['integer', 'null'] },
            height: { type: ['integer', 'null'] },
            bytes: { type: ['integer', 'null'] },
            sha256: { type: ['string', 'null'] },
          },
        },
        text: {
          type: 'object',
          required: ['raw_ocr', 'value', 'ingredients'],
          properties: {
            raw_ocr: { type: 'string' },
            corrected: { type: ['string', 'null'] },
            value: { type: 'string' },
            ingredients: { type: 'array', items: { type: 'string' } },
            ingredient_text: { type: ['string', 'null'] },
          },
        },
        label: {
          type: 'object',
          required: ['gold', 'label_id', 'multilabel'],
          properties: {
            gold: { enum: ['safe', 'unsafe'] },
            label_id: { enum: [0, 1] },
            multilabel: { type: 'array', items: { type: 'string' } },
          },
        },
        allergens: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'label', 'presence'],
            properties: {
              name: { type: 'string' },
              label: { type: 'string' },
              severity: { enum: ['low', 'medium', 'high', 'critical'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              presence: {
                enum: ['present', 'absent', 'unknown', 'may_contain', 'cross_contamination', 'not_stated', 'not_evaluated'],
              },
              evidence: { type: ['string', 'null'] },
            },
          },
        },
        acquisition: { type: 'object' },
        annotation: { type: 'object' },
        provenance: { type: 'object' },
        split: { enum: ['train', 'validation', 'test', null] },
      },
    };
  }

  private annotationSchema() {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://allergen-detector.local/schema/annotation.schema.json',
      title: 'Allergen annotation',
      type: 'object',
      required: ['record_id', 'allergen', 'presence'],
      properties: {
        record_id: { type: 'string' },
        allergen: { type: 'string' },
        label: { type: 'string' },
        presence: {
          enum: ['present', 'absent', 'unknown', 'may_contain', 'cross_contamination', 'not_stated', 'not_evaluated'],
        },
        severity: { enum: ['low', 'medium', 'high', 'critical'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidence: { type: ['string', 'null'] },
        method: { type: ['string', 'null'] },
        human_verified: { type: 'boolean' },
      },
    };
  }

  private readme(profile: ExportProfile, manifest: any): string {
    const tree: Record<ExportProfile, string> = {
      raw: `dataset-export/
├── README.md
├── dataset_manifest.json
├── schema/{record,annotation}.schema.json
├── annotations/records.<jsonl|json|csv>
├── images/original/<record_id>.<ext>
└── checksums/SHA256SUMS`,
      nlp: `dataset-export/
├── README.md
├── dataset_manifest.json
├── schema/record.schema.json
├── text/{raw_ocr,corrected_ocr,normalized_ingredients}.txt
├── annotations/{records.<format>,allergens.jsonl}
├── splits/{train,validation,test}.<format>
└── checksums/SHA256SUMS`,
      image_classification: `dataset-export/
├── README.md
├── dataset_manifest.json
├── schema/record.schema.json
├── images/all/<record_id>.<ext>
├── labels.csv
├── splits/{train,validation,test}.csv
└── checksums/SHA256SUMS`,
      multimodal: `dataset-export/
├── README.md
├── dataset_manifest.json
├── schema/record.schema.json
├── images/original/<record_id>.<ext>
├── text/{raw_ocr,corrected_ocr}.txt
├── annotations/records.<format>
├── splits/{train,validation,test}.<format>
└── checksums/SHA256SUMS`,
    };
    const examples: Record<ExportProfile, string> = {
      raw: `## Memuat di Python
\`\`\`python
import json, pathlib
root = pathlib.Path("dataset-export")
manifest = json.loads((root / "dataset_manifest.json").read_text())
records = [json.loads(line) for line in (root / "annotations/records.jsonl").read_text().splitlines()]
print(manifest["counts"], records[0]["record_id"])
\`\`\``,
      nlp: `## Hugging Face / IndoBERT (multi-label)
\`\`\`python
from datasets import load_dataset
ds = load_dataset("json", data_files={"train": "dataset-export/splits/train.jsonl"})
def to_features(ex):
    return {"text": ex["text"], "labels": [1.0 if a["present"] else 0.0 for a in ex["allergens"]]}
\`\`\`

## BiLSTM / PyTorch
\`\`\`python
import json
from torch.utils.data import Dataset
class IngredientDataset(Dataset):
    def __init__(self, path):
        self.rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    def __len__(self): return len(self.rows)
    def __getitem__(self, i):
        r = self.rows[i]
        return {"text": r["text"], "label": r["label"]["label_id"]}
\`\`\`

> Label multi-label: gunakan \`label.multilabel\` / daftar \`allergens\`,
> jangan memaksa satu kelas eksklusif.`,
      image_classification: `## PyTorch / torchvision
\`\`\`python
import pandas as pd
from torch.utils.data import Dataset
from PIL import Image
class LabelDataset(Dataset):
    def __init__(self, csv_path, image_dir):
        self.df = pd.read_csv(csv_path)
        self.image_dir = image_dir
    def __len__(self): return len(self.df)
    def __getitem__(self, i):
        row = self.df.iloc[i]
        img = Image.open(f"{self.image_dir}/{row.file_name}").convert("RGB")
        return img, int(row.label_id)
\`\`\`

## TensorFlow
\`\`\`python
import pandas as pd, tensorflow as tf
df = pd.read_csv("dataset-export/splits/train.csv")
paths = "dataset-export/images/all/" + df.file_name
ds = tf.data.Dataset.from_tensor_slices((paths.values, df.label_id.values))
\`\`\`

> \`labels.csv\` memuat kolom biner \`allergen_*\` untuk klasifikasi multi-label.
> Direktori gambar tidak diduplikasi per split; gunakan file split CSV.`,
      multimodal: `## PyTorch multimodal
\`\`\`python
import json, torch
from PIL import Image
from torch.utils.data import Dataset
class MultimodalDataset(Dataset):
    def __init__(self, path, root):
        self.rows = [json.loads(l) for l in open(path, encoding="utf-8")]
        self.root = root
    def __getitem__(self, i):
        r = self.rows[i]
        img = Image.open(f"{self.root}/{r['image']['path']}").convert("RGB")
        return img, r["text"]["value"], r["label"]["label_id"]
\`\`\``,
    };
    return `# Dataset Ekspor Alergen — ${profile}

Dibuat: ${manifest.generated_at}
Export ID: \`${manifest.export_id}\`
Dataset version: \`${manifest.dataset_version}\`
Schema: \`${manifest.schema_version}\`
Record: ${manifest.counts.records} • Gambar: ${manifest.counts.images} • Dikecualikan: ${manifest.counts.excluded}

## Struktur
\`\`\`
${tree[profile]}
\`\`\`

${examples[profile]}

## Integritas
- Split seed: ${manifest.split?.seed ?? '-'} • rasio: ${JSON.stringify(manifest.split?.ratios ?? {})}
- Audit disjoint: ${manifest.integrity.audit_passed ? 'PASS' : 'FAIL'}
- Checksums: \`checksums/SHA256SUMS\` (sha256 berkas teks & gambar)
- Label: 0=safe, 1=unsafe. Alergen direpresentasikan multi-label.
- Ketidakhadiran alergen TIDAK boleh disimpulkan dari tidak adanya sebutan;
  gunakan \`presence\` pada tiap anotasi.
`;
  }

  private async sha256File(path: string): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const hash = createHash('sha256');
      createReadStream(path)
        .on('data', (d) => hash.update(d))
        .on('error', reject)
        .on('end', () => resolvePromise(hash.digest('hex')));
    });
  }

  async create(dto: CreateDatasetExportDto, adminId?: number) {
    const p = await this.prepare(dto);
    if (p.rows.length === 0) {
      httpError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Tidak ada record yang memenuhi syarat ekspor. Periksa filter & status.',
        'EMPTY_EXPORT',
        [{ field: 'status', message: 'Seleksi kosong' }],
      );
    }
    const profile = p.cfg.profile;
    const format = p.cfg.format;
    const files: FileEntry[] = [];
    const pushContent = (path: string, content: string | Buffer) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      files.push({ path, content: buf, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
    };

    const allRecords = this.serializeRecords(p.rows, format, {
      includeImages: p.cfg.includeImages,
      imageDir: profile === 'image_classification' ? 'images/all' : 'images/original',
    });
    const allergenLines =
      p.rows
        .flatMap((r) =>
          r.allergens.map((a) => ({
            record_id: r.recordId,
            allergen: a.name,
            label: `allergen_${slugify(a.name)}`,
            presence: a.presence ?? 'present',
            severity: a.severity,
            confidence: a.confidence,
            evidence: a.evidence ?? null,
            method: r.item.annotationSource ?? null,
            human_verified: ['verified', 'approved'].includes(String(r.item.status)),
          })),
        )
        .map((o) => JSON.stringify(o))
        .join('\n') + (p.rows.some((r) => r.allergens.length) ? '\n' : '');

    if (profile === 'raw') {
      pushContent(
        format === 'json' ? 'annotations/records.json' : format === 'csv' ? 'annotations/records.csv' : 'annotations/records.jsonl',
        allRecords,
      );
      if (p.cfg.includeImages) {
        for (const r of p.rows) {
          if (!r.image) continue;
          files.push({
            path: `images/original/${r.recordId}.${r.image.ext}`,
            srcPath: r.image.abs,
            bytes: r.image.bytes,
            sha256: await this.sha256File(r.image.abs),
          });
        }
      }
      if (p.cfg.includeSplits && p.split) {
        for (const b of ['train', 'validation', 'test'] as const) {
          pushContent(
            `splits/${b}.${format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'jsonl'}`,
            this.serializeRecords(this.splitRows(p.rows, b), format, { includeImages: p.cfg.includeImages }),
          );
        }
      }
    }

    if (profile === 'nlp') {
      pushContent('text/raw_ocr.txt', p.rows.map((r) => `${r.recordId}\t${r.ocrText.replace(/\s*\r?\n\s*/g, ' ').trim()}`).join('\n') + '\n');
      pushContent(
        'text/corrected_ocr.txt',
        p.rows.map((r) => `${r.recordId}\t${String(r.item.correctedText ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()}`).join('\n') + '\n',
      );
      pushContent(
        'text/normalized_ingredients.txt',
        p.rows.map((r) => `${r.recordId}\t${r.ingredients.join(', ')}`).join('\n') + '\n',
      );
      pushContent(format === 'csv' ? 'annotations/records.csv' : format === 'json' ? 'annotations/records.json' : 'annotations/records.jsonl', allRecords);
      pushContent('annotations/allergens.jsonl', allergenLines);
      if (p.cfg.includeSplits && p.split) {
        for (const b of ['train', 'validation', 'test'] as const) {
          const subset = this.splitRows(p.rows, b);
          pushContent(`splits/${b}.${format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'jsonl'}`, this.serializeRecords(subset, format, { includeImages: p.cfg.includeImages }));
        }
      }
    }

    if (profile === 'image_classification') {
      if (p.cfg.includeImages) {
        for (const r of p.rows) {
          if (!r.image) continue;
          files.push({
            path: `images/all/${r.recordId}.${r.image.ext}`,
            srcPath: r.image.abs,
            bytes: r.image.bytes,
            sha256: await this.sha256File(r.image.abs),
          });
        }
      }
      pushContent('labels.csv', this.labelsCsv(p.rows, true));
      if (format === 'jsonl') pushContent('labels.jsonl', allRecords);
      if (format === 'json') pushContent('annotations/records.json', allRecords);
      if (p.cfg.includeSplits && p.split) {
        for (const b of ['train', 'validation', 'test'] as const) {
          pushContent(`splits/${b}.csv`, this.labelsCsv(this.splitRows(p.rows, b), false));
        }
      }
    }

    if (profile === 'multimodal') {
      pushContent(
        format === 'csv' ? 'annotations/records.csv' : format === 'json' ? 'annotations/records.json' : 'annotations/records.jsonl',
        allRecords,
      );
      pushContent('annotations/allergens.jsonl', allergenLines);
      pushContent('text/raw_ocr.txt', p.rows.map((r) => `${r.recordId}\t${r.ocrText.replace(/\s*\r?\n\s*/g, ' ').trim()}`).join('\n') + '\n');
      pushContent(
        'text/corrected_ocr.txt',
        p.rows.map((r) => `${r.recordId}\t${String(r.item.correctedText ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()}`).join('\n') + '\n',
      );
      if (p.cfg.includeImages) {
        for (const r of p.rows) {
          if (!r.image) continue;
          files.push({
            path: `images/original/${r.recordId}.${r.image.ext}`,
            srcPath: r.image.abs,
            bytes: r.image.bytes,
            sha256: await this.sha256File(r.image.abs),
          });
        }
      }
      if (p.cfg.includeSplits && p.split) {
        for (const b of ['train', 'validation', 'test'] as const) {
          pushContent(`splits/${b}.${format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'jsonl'}`, this.serializeRecords(this.splitRows(p.rows, b), format, { includeImages: p.cfg.includeImages }));
        }
      }
    }

    if (p.cfg.includeSchema) {
      pushContent('schema/record.schema.json', JSON.stringify(this.recordSchema(), null, 2));
      pushContent('schema/annotation.schema.json', JSON.stringify(this.annotationSchema(), null, 2));
    }

    const exportId = `exp_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 10)}`;
    const datasetVersion = `v${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.${p.rows.length}.${createHash('sha256')
      .update(JSON.stringify(p.rows.map((r) => [r.item.id, r.item.updatedAt ?? null])))
      .digest('hex')
      .slice(0, 8)}`;

    const manifest: any = {
      export_id: exportId,
      generated_at: new Date().toISOString(),
      dataset_version: datasetVersion,
      schema_version: DATASET_EXPORT_SCHEMA_VERSION,
      profile,
      format,
      counts: {
        records: p.rows.length,
        images: files.filter((f) => f.srcPath).length,
        excluded: p.excluded.length,
        allergens: p.allergenDistribution.length,
        files: files.length + 3,
      },
      label_distribution: p.labelDistribution,
      allergen_distribution: p.allergenDistribution,
      filters: {
        status: p.cfg.statuses,
        label: p.cfg.label ?? null,
        search: p.cfg.search ?? null,
        ids: p.cfg.ids ?? null,
      },
      split: p.split,
      excluded: p.excluded,
      warnings: p.warnings,
      integrity: {
        audit_passed: p.split ? p.split.audit.every((a) => a.status === 'PASS') : true,
        missing_images: p.rows.filter((r) => !r.image).length,
        validation_errors: p.validationErrors,
        validation_warnings: p.validationWarnings,
        missing_text: p.missingText,
      },
      files: [] as Array<{ path: string; bytes: number; sha256: string }>,
    };
    pushContent('README.md', this.readme(profile, manifest));
    manifest.files = files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 }));
    pushContent('dataset_manifest.json', JSON.stringify(manifest, null, 2));
    pushContent(
      'checksums/SHA256SUMS',
      files
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => `${f.sha256}  ${f.path}`)
        .join('\n') + '\n',
    );

    const dir = exportsDir();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `dataset_${profile}_${ymd}_${p.rows.length}records_${exportId.slice(-6)}.zip`;
    const absZip = join(dir, filename);

    try {
      await new Promise<void>((resolvePromise, reject) => {
        const output = createWriteStream(absZip);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolvePromise());
        output.on('error', reject);
        archive.on('warning', (err: any) => this.logger.warn(`ZIP warning: ${err?.message}`));
        archive.on('error', reject);
        archive.pipe(output);
        for (const f of files) {
          if (f.srcPath) archive.file(f.srcPath, { name: f.path });
          else archive.append(f.content ?? Buffer.alloc(0), { name: f.path });
        }
        void archive.finalize();
      });
    } catch (e) {
      // Jangan tinggalkan ZIP parsial yang bisa disalahartikan sebagai sukses.
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(absZip);
      } catch {
        /* berkas mungkin belum dibuat */
      }
      this.logger.error(`Ekspor ${exportId} gagal: ${(e as any)?.message}`);
      throw e;
    }

    const bytes = statSync(absZip).size;
    const checksum = await this.sha256File(absZip);
    const record = await this.exportModel.create({
      exportId,
      profile,
      format,
      status: 'completed',
      recordCount: p.rows.length,
      imageCount: files.filter((f) => f.srcPath).length,
      bytes,
      filename,
      checksum,
      filePath: absZip,
      config: {
        ...p.cfg,
        ratios: p.split?.ratios ?? p.cfg.ratios,
      },
      warnings: p.warnings,
      excluded: p.excluded,
      manifest,
      createdBy: adminId ?? null,
    } as any);
    await this.audit('create', {
      exportId,
      profile,
      format,
      records: p.rows.length,
      bytes,
      adminId: adminId ?? null,
    });
    return this.serializeExport(record as any);
  }

  private serializeExport(record: any) {
    return {
      id: record.id,
      exportId: record.exportId ?? record.export_id,
      profile: record.profile,
      format: record.format,
      status: record.status,
      recordCount: record.recordCount ?? record.record_count,
      imageCount: record.imageCount ?? record.image_count,
      bytes: Number(record.bytes ?? 0),
      filename: record.filename,
      checksum: record.checksum,
      config: record.config,
      warnings: record.warnings ?? [],
      excluded: record.excluded ?? [],
      manifest: record.manifest ?? null,
      createdAt: record.createdAt ?? record.created_at,
      downloadUrl: `/api/v1/dataset-items/exports/${record.id}/download`,
    };
  }

  async list(query: { page?: number; limit?: number }) {
    const page = Number.isFinite(+query.page!) && +query.page! > 0 ? Math.floor(+query.page!) : 1;
    const limit = Number.isFinite(+query.limit!) && +query.limit! > 0 ? Math.min(Math.floor(+query.limit!), 50) : 10;
    const { rows, count } = await this.exportModel.findAndCountAll({
      offset: (page - 1) * limit,
      limit,
      order: [['createdAt', 'DESC']],
    });
    return {
      data: rows.map((r) => this.serializeExport(r)),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    };
  }

  async getForDownload(id: number) {
    const record: any = await this.exportModel.findByPk(id);
    if (!record) httpError(HttpStatus.NOT_FOUND, 'Riwayat ekspor tidak ditemukan', 'EXPORT_NOT_FOUND');
    const abs = resolve(String(record.filePath ?? ''));
    const root = resolve(exportsDir()) + sep;
    if (!abs.startsWith(root) || !existsSync(abs)) {
      httpError(HttpStatus.GONE, 'Berkas ekspor sudah tidak tersedia', 'EXPORT_FILE_MISSING');
    }
    return { record, abs, filename: record.filename ?? basename(abs) };
  }

  /** Statistik ringkas untuk UI ekspor (tanpa membaca isi gambar). */
  async summary() {
    const rows: any[] = await this.exportModel.findAll({
      attributes: ['id', 'profile', 'recordCount', 'bytes', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 5,
    });
    const total = await this.exportModel.count();
    return {
      total,
      recent: rows.map((r) => this.serializeExport(r)),
    };
  }
}
