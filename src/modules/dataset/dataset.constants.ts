/**
 * Domain dataset platform: satu sumber kebenaran untuk status, transisi,
 * sumber akuisisi, tipe gambar, semantik alergen, dan profil ekspor.
 *
 * Aturan status ditegakkan backend (otoritatif). Frontend hanya menampilkan
 * opsi yang diizinkan oleh endpoint statistik/validasi.
 */

export const DATASET_STATUSES = [
  'draft',
  'pending_review',
  'needs_correction',
  'verified',
  'approved',
  'rejected',
  'archived',
] as const;
export type DatasetStatus = (typeof DATASET_STATUSES)[number];

/** Status yang boleh masuk ekspor default (dataset siap latih). */
export const EXPORTABLE_STATUSES: DatasetStatus[] = ['verified', 'approved'];

/** Transisi status yang sah. Kunci = status asal. */
export const STATUS_TRANSITIONS: Record<DatasetStatus, DatasetStatus[]> = {
  draft: ['pending_review', 'verified', 'archived'],
  pending_review: ['needs_correction', 'verified', 'approved', 'rejected', 'archived'],
  needs_correction: ['draft', 'pending_review', 'rejected', 'archived'],
  verified: ['approved', 'needs_correction', 'archived'],
  approved: ['needs_correction', 'archived'],
  rejected: ['draft', 'needs_correction', 'archived'],
  archived: ['draft'],
};

export const DATASET_SOURCES = ['detection', 'manual', 'import', 'user_submission'] as const;
export type DatasetSource = (typeof DATASET_SOURCES)[number];

export const ACQUISITION_SOURCES = [
  'user_scan',
  'admin_manual',
  'admin_import',
  'detection_promotion',
  'ocr_correction',
] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export const IMAGE_TYPES = [
  'front_packaging',
  'ingredient_label',
  'nutrition_label',
  'allergen_warning',
  'other',
] as const;
export type DatasetImageType = (typeof IMAGE_TYPES)[number];

export const OCR_STATUSES = ['pending', 'processed', 'failed', 'corrected'] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

export const QUALITY_STATUSES = ['unassessed', 'ok', 'warning', 'error'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export const ANNOTATION_SOURCES = ['model', 'human', 'import', 'hybrid'] as const;
export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number];

export const ALLERGEN_PRESENCE = [
  'present',
  'absent',
  'unknown',
  'may_contain',
  'cross_contamination',
  'not_stated',
  'not_evaluated',
] as const;
export type AllergenPresence = (typeof ALLERGEN_PRESENCE)[number];

export const ALLERGEN_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type AllergenSeverity = (typeof ALLERGEN_SEVERITIES)[number];

export const EXPORT_PROFILES = ['raw', 'nlp', 'image_classification', 'multimodal'] as const;
export type ExportProfile = (typeof EXPORT_PROFILES)[number];

export const EXPORT_FORMATS = ['jsonl', 'csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const DEFAULT_PROFILE_FORMAT: Record<ExportProfile, ExportFormat> = {
  raw: 'json',
  nlp: 'jsonl',
  image_classification: 'csv',
  multimodal: 'jsonl',
};

export const SPLIT_GROUPINGS = ['detection', 'text', 'none'] as const;
export type SplitGrouping = (typeof SPLIT_GROUPINGS)[number];

export const SPLIT_STRATEGIES = ['random', 'label', 'multilabel'] as const;
export type SplitStrategy = (typeof SPLIT_STRATEGIES)[number];

export const DATASET_SCHEMA_VERSION = '1.0.0';
export const DATASET_EXPORT_SCHEMA_VERSION = '1.0.0';

/** Semantik alergen: presence yang berarti "kandungan positif" untuk label. */
export const POSITIVE_PRESENCE: AllergenPresence[] = ['present', 'may_contain', 'cross_contamination'];

/** Status yang dianggap "sudah ditinjau manusia" (bukan draft mentah). */
export const REVIEWED_STATUSES: DatasetStatus[] = ['verified', 'approved'];

export function isDatasetStatus(v: unknown): v is DatasetStatus {
  return typeof v === 'string' && (DATASET_STATUSES as readonly string[]).includes(v);
}

export function canTransition(from: string, to: string): boolean {
  if (!isDatasetStatus(from) || !isDatasetStatus(to)) return false;
  if (from === to) return true;
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Ambil ext aman untuk nama file gambar (tanpa dot). */
export function safeImageExt(filename: string | null | undefined, mime?: string | null): string {
  const fromName = String(filename ?? '')
    .toLowerCase()
    .match(/\.([a-z0-9]{2,5})$/)?.[1];
  const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
  if (fromName && allowed.includes(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  const m = String(mime ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('bmp')) return 'bmp';
  return 'jpg';
}
