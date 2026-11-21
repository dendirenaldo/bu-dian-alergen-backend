import { Injectable } from '@nestjs/common';
import {
  ALLERGEN_PRESENCE,
  ALLERGEN_SEVERITIES,
  POSITIVE_PRESENCE,
  REVIEWED_STATUSES,
  type AllergenPresence,
  type AllergenSeverity,
  type DatasetStatus,
  type QualityStatus,
} from './dataset.constants';
import type { CorrectedAllergen, ValidationIssue } from './models/dataset-item.model';

export function slugify(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/** Teks utama record: koreksi manusia > OCR mentah. */
export function datasetTextOf(item: any): string {
  const v =
    item?.correctedText ??
    item?.corrected_text ??
    item?.ocrText ??
    item?.ocr_text ??
    '';
  return String(v ?? '');
}

export function datasetOcrTextOf(item: any): string {
  const v = item?.ocrText ?? item?.ocr_text ?? '';
  return String(v ?? '');
}

export function allergensOf(item: any): CorrectedAllergen[] {
  const raw = item?.correctedAllergens ?? item?.corrected_allergens ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === 'object')
    .map((a: any) => ({
      name: String(a.name ?? '').trim(),
      severity: (ALLERGEN_SEVERITIES as readonly string[]).includes(String(a.severity))
        ? (a.severity as AllergenSeverity)
        : 'medium',
      confidence: Number.isFinite(Number(a.confidence)) ? Number(a.confidence) : 0,
      presence: (ALLERGEN_PRESENCE as readonly string[]).includes(String(a.presence))
        ? (a.presence as AllergenPresence)
        : 'present',
      evidence: a.evidence ? String(a.evidence) : undefined,
    }))
    .filter((a) => a.name.length > 0);
}

/** Normalisasi anotasi: default presence & nilai aman, tanpa mengubah input. */
export function normalizeAllergens(input: any): CorrectedAllergen[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((a: any) => {
      const name = String(a?.name ?? '').trim();
      if (!name) return null;
      const severity = (ALLERGEN_SEVERITIES as readonly string[]).includes(String(a?.severity))
        ? (a.severity as AllergenSeverity)
        : 'medium';
      const confidence = Number(a?.confidence);
      return {
        name,
        severity,
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 1,
        presence: (ALLERGEN_PRESENCE as readonly string[]).includes(String(a?.presence))
          ? (a.presence as AllergenPresence)
          : 'present',
        ...(a?.evidence ? { evidence: String(a.evidence).slice(0, 500) } : {}),
      } as CorrectedAllergen;
    })
    .filter((a): a is CorrectedAllergen => !!a);
}

export function positiveAllergens(item: any): CorrectedAllergen[] {
  return allergensOf(item).filter((a) => POSITIVE_PRESENCE.includes(a.presence ?? 'present'));
}

/** Vektor label multilabel untuk split/stratifikasi & export klasifikasi. */
export function allergenLabelSet(item: any): string[] {
  const labels = new Set<string>();
  labels.add(String(item?.goldLabel ?? item?.gold_label ?? 'safe'));
  for (const a of allergensOf(item)) {
    const slug = slugify(a.name);
    if (slug) labels.add(`allergen_${slug}`);
  }
  return [...labels].sort();
}

export interface ValidationContext {
  knownAllergens?: Set<string>;
  duplicateOf?: number | null;
  imageMime?: string | null;
  imageSize?: number | null;
  requireComplete?: boolean;
}

export function isReviewedStatus(status: string): boolean {
  return (REVIEWED_STATUSES as string[]).includes(status);
}

/**
 * Aturan validasi record dataset. Backend otoritatif; frontend hanya
 * mencerminkan hasil ini. Error = blokir submit/approve, warning = boleh
 * disimpan tetapi perlu perhatian.
 */
export function computeValidationIssues(item: any, ctx: ValidationContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const status = String(item?.status ?? 'draft') as DatasetStatus;
  const requireComplete = ctx.requireComplete ?? (status !== 'draft' && status !== 'needs_correction' && status !== 'archived');
  const text = datasetTextOf(item).trim();
  const ocr = datasetOcrTextOf(item).trim();
  const productName = String(item?.productName ?? item?.product_name ?? '').trim();
  const allergens = allergensOf(item);
  const positives = allergens.filter((a) => POSITIVE_PRESENCE.includes(a.presence ?? 'present'));
  const gold = String(item?.goldLabel ?? item?.gold_label ?? 'safe');
  const add = (severity: 'error' | 'warning', code: string, field: string, message: string) =>
    issues.push({ severity, code, field, message });

  if (!productName) {
    add(requireComplete ? 'error' : 'warning', 'MISSING_PRODUCT_NAME', 'product_name', 'Nama produk belum diisi.');
  }
  if (!text) {
    add(requireComplete ? 'error' : 'warning', 'MISSING_TEXT', 'corrected_text', 'Teks bahan (OCR/koreksi) masih kosong.');
  } else if (text.length < 10) {
    add('warning', 'TEXT_TOO_SHORT', 'corrected_text', 'Teks bahan sangat pendek; periksa kembali hasil OCR.');
  }
  if (!ocr && text) {
    add('warning', 'MISSING_RAW_OCR', 'ocr_text', 'OCR mentah tidak tersimpan; provenance OCR tidak lengkap.');
  }
  if (!item?.imageUrl && !item?.image_url && !(item as any)?.detection?.imageUrl) {
    add('warning', 'MISSING_IMAGE', 'image', 'Belum ada gambar label. Ekspor gambar akan mengecualikan record ini.');
  }
  const mime = String(ctx.imageMime ?? item?.imageMime ?? item?.image_mime ?? '').trim();
  if (mime && !mime.startsWith('image/')) {
    add('error', 'INVALID_IMAGE_MIME', 'image_mime', `Tipe berkas gambar tidak didukung: ${mime}.`);
  }
  const size = Number(ctx.imageSize ?? item?.imageSize ?? item?.image_size ?? 0);
  if (size > 5 * 1024 * 1024) {
    add('error', 'IMAGE_TOO_LARGE', 'image_size', 'Ukuran gambar melebihi 5 MB.');
  }
  if (item?.ocrStatus === 'failed' || item?.ocr_status === 'failed') {
    add('warning', 'OCR_FAILED', 'ocr_status', item?.ocrError || 'OCR gagal diproses.');
  }

  const ingredientText = String(item?.ingredientText ?? item?.ingredient_text ?? '').trim();
  const ingredients = item?.normalizedIngredients ?? item?.normalized_ingredients;
  if (!ingredientText && (!Array.isArray(ingredients) || ingredients.length === 0) && text) {
    add('warning', 'MISSING_INGREDIENTS', 'ingredient_text', 'Daftar bahan terstruktur belum diisi.');
  }

  for (const a of allergens) {
    if (!(ALLERGEN_SEVERITIES as readonly string[]).includes(String(a.severity))) {
      add('error', 'INVALID_ALLERGEN_SEVERITY', 'corrected_allergens', `Severity alergen "${a.name}" tidak valid.`);
    }
    if (!Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) {
      add('error', 'INVALID_ALLERGEN_CONFIDENCE', 'corrected_allergens', `Confidence alergen "${a.name}" harus 0..1.`);
    }
    if (ctx.knownAllergens && ctx.knownAllergens.size > 0 && !ctx.knownAllergens.has(a.name)) {
      add('error', 'UNKNOWN_ALLERGEN', 'corrected_allergens', `Alergen "${a.name}" tidak ada di master alergen.`);
    }
  }
  if (gold === 'safe' && positives.length > 0) {
    add(
      'error',
      'LABEL_CONFLICT',
      'gold_label',
      `Label "aman" bertentangan dengan alergen positif: ${positives.map((a) => a.name).join(', ')}.`,
    );
  }
  if (gold === 'unsafe' && positives.length === 0) {
    add('warning', 'LABEL_WITHOUT_EVIDENCE', 'gold_label', 'Label "tidak aman" tanpa alergen positif yang tercatat.');
  }
  if (requireComplete) {
    // "Tidak ada alergen" sah hanya bila manusia menyatakan sudah memeriksa
    // (annotatedAt + annotationSource=human). Anotasi model/impor tanpa
    // konfirmasi tetap dianggap belum lengkap.
    const humanDeclared =
      !!item?.annotatedAt &&
      String(item?.annotationSource ?? item?.annotation_source ?? '') === 'human';
    if (allergens.length === 0 && !humanDeclared) {
      add(
        'error',
        'MISSING_ANNOTATION',
        'corrected_allergens',
        'Anotasi alergen belum diisi. Ketidakhadiran alergen harus dinyatakan eksplisit, bukan diasumsikan.',
      );
    } else if (allergens.length === 0) {
      add(
        'warning',
        'NO_ALLERGEN_RECORDED',
        'corrected_allergens',
        'Tidak ada alergen tercatat. Pastikan label benar-benar sudah diperiksa.',
      );
    }
  }
  if (isReviewedStatus(status) && String(item?.annotationSource ?? item?.annotation_source ?? '') === 'model') {
    add('warning', 'UNVERIFIED_LABEL', 'annotation_source', 'Anotasi masih berasal dari model dan belum dikonfirmasi manusia.');
  }
  if (ctx.duplicateOf) {
    add('warning', 'DUPLICATE_RECORD', 'duplicate_of', `Record terindikasi duplikat dari #${ctx.duplicateOf}.`);
  }
  return issues;
}

export function qualityFromIssues(issues: ValidationIssue[]): QualityStatus {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  if (issues.length > 0) return 'warning';
  return 'ok';
}

export function blockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

@Injectable()
export class DatasetValidationService {
  evaluate(item: any, ctx: ValidationContext = {}) {
    const issues = computeValidationIssues(item, ctx);
    return { issues, qualityStatus: qualityFromIssues(issues) };
  }
}

export type { DatasetStatus, QualityStatus };
