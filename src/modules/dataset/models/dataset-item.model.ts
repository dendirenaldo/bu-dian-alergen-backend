import { Table, Column, Model, DataType, BelongsTo, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { parseJsonArray } from '../../../common/utils/json-field';
import { Detection } from '../../detections/models/detection.model';
import { User } from '../../users/models/user.model';
import type { AllergenPresence, AllergenSeverity } from '../dataset.constants';

export interface CorrectedAllergen {
  name: string;
  severity: AllergenSeverity;
  confidence: number;
  /** Semantik keberadaan alergen. Default migrasi lama: present. */
  presence?: AllergenPresence;
  /** Potongan teks label yang menjadi bukti. */
  evidence?: string;
}

export interface ValidationIssue {
  code: string;
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

@Table({ tableName: 'dataset_items', timestamps: true, underscored: true })
export class DatasetItem extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => Detection)
  @Column({ type: DataType.INTEGER, allowNull: true, unique: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  detectionId: number;

  @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'detection' })
  source: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  acquisitionSource: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  acquisitionContext: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  sourceAppVersion: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  submittedBy: number;

  @Column({ type: DataType.DATE, allowNull: true })
  submittedAt: Date;

  // ---- Identitas produk -------------------------------------------------
  @Column({ type: DataType.STRING(255), allowNull: true })
  productName: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  brand: string;

  @Column({ type: DataType.STRING(120), allowNull: true })
  category: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  barcode: string;

  // ---- Metadata gambar --------------------------------------------------
  @Column({ type: DataType.STRING(500), allowNull: true })
  imageUrl: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  imageType: string;

  @Column({ type: DataType.STRING(100), allowNull: true })
  imageMime: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  imageSize: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  imageWidth: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  imageHeight: number;

  @Column({ type: DataType.STRING(64), allowNull: true })
  imageChecksum: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  originalFilename: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  storedFilename: string;

  // ---- OCR --------------------------------------------------------------
  @Column({ type: DataType.TEXT, allowNull: true })
  ocrText: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  correctedText: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  ocrEngine: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  ocrEngineVersion: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  ocrStatus: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  ocrError: string;

  @Column({ type: DataType.DATE, allowNull: true })
  ocrProcessedAt: Date;

  // ---- Bahan / ingredien ------------------------------------------------
  @Column({ type: DataType.TEXT, allowNull: true })
  ingredientText: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    get(this: any) {
      const raw = this.getDataValue('normalizedIngredients');
      if (raw === null || raw === undefined) return null;
      return parseJsonArray<string>(raw, []);
    },
    set(this: any, val: any) {
      this.setDataValue('normalizedIngredients', val ?? null);
    },
  })
  normalizedIngredients: string[];

  @Column({ type: DataType.STRING(32), allowNull: true })
  extractionMethod: string;

  // ---- Label & anotasi --------------------------------------------------
  @Column({ type: DataType.STRING(16), allowNull: false })
  goldLabel: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    // MariaDB mengembalikan JSON sebagai LONGTEXT string — parse defensif agar
    // konsumen (service/frontend) selalu menerima array (null bila kosong).
    get(this: any) {
      const raw = this.getDataValue('correctedAllergens');
      if (raw === null || raw === undefined) return null;
      return parseJsonArray<CorrectedAllergen>(raw, []);
    },
    set(this: any, val: any) {
      this.setDataValue('correctedAllergens', val ?? null);
    },
  })
  correctedAllergens: CorrectedAllergen[];

  @Column({ type: DataType.STRING(32), allowNull: true })
  annotationSource: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  annotationVersion: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  annotationSchemaVersion: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  annotatorId: number;

  @Column({ type: DataType.DATE, allowNull: true })
  annotatedAt: Date;

  // ---- Status & kualitas ------------------------------------------------
  @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'draft' })
  status: string;

  @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'unassessed' })
  qualityStatus: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    get(this: any) {
      const raw = this.getDataValue('validationErrors');
      if (raw === null || raw === undefined) return null;
      return parseJsonArray<ValidationIssue>(raw, []);
    },
    set(this: any, val: any) {
      this.setDataValue('validationErrors', val ?? null);
    },
  })
  validationErrors: ValidationIssue[];

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  exportEligible: boolean;

  @Column({ type: DataType.INTEGER, allowNull: true })
  duplicateOf: number;

  @Column({ type: DataType.STRING(64), allowNull: true })
  duplicateHash: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  reviewNote: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  reviewedBy: number;

  @Column({ type: DataType.DATE, allowNull: true })
  reviewedAt: Date;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  verifiedBy: number;

  @Column({ type: DataType.DATE, allowNull: true })
  verifiedAt: Date;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes: string;

  @BelongsTo(() => Detection)
  detection: Detection;

  @BelongsTo(() => User, 'verifiedBy')
  verifier: User;

  @BelongsTo(() => User, 'reviewedBy')
  reviewer: User;

  @BelongsTo(() => User, 'submittedBy')
  submitter: User;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
