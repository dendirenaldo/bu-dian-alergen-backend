import { Table, Column, Model, DataType, BelongsTo, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { parseJsonArray } from '../../../common/utils/json-field';
import { Detection } from '../../detections/models/detection.model';
import { User } from '../../users/models/user.model';

export interface CorrectedAllergen {
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
}

@Table({ tableName: 'dataset_items', timestamps: true, underscored: true })
export class DatasetItem extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => Detection)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  detectionId: number;

  @Column({ type: DataType.ENUM('detection', 'manual'), allowNull: false, defaultValue: 'detection' })
  source: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  ocrText: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  correctedText: string;

  @Column({ type: DataType.ENUM('safe', 'unsafe'), allowNull: false })
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

  @Column({ type: DataType.ENUM('draft', 'verified'), allowNull: false, defaultValue: 'draft' })
  status: string;

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

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
