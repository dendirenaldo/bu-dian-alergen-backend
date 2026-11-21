import { Table, Column, Model, DataType, ForeignKey, CreatedAt } from 'sequelize-typescript';
import { parseJsonArray, parseJsonObject } from '../../../common/utils/json-field';
import { User } from '../../users/models/user.model';

export interface ExportWarning {
  code: string;
  message: string;
  recordIds?: number[];
}

/** Riwayat ekspor: snapshot konfigurasi + hasil, agar unduhan lama tetap konsisten. */
@Table({ tableName: 'dataset_exports', timestamps: false, underscored: true })
export class DatasetExport extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(64), allowNull: false, unique: true })
  exportId: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  profile: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  format: string;

  @Column({ type: DataType.STRING(24), allowNull: false, defaultValue: 'completed' })
  status: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  recordCount: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  imageCount: number;

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: 0 })
  bytes: number;

  @Column({ type: DataType.STRING(255), allowNull: true })
  filename: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  checksum: string;

  @Column({ type: DataType.STRING(500), allowNull: true })
  filePath: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    get(this: any) {
      const raw = this.getDataValue('config');
      if (raw === null || raw === undefined) return null;
      return parseJsonObject(raw, {});
    },
    set(this: any, val: any) {
      this.setDataValue('config', val ?? null);
    },
  })
  config: Record<string, unknown>;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    get(this: any) {
      const raw = this.getDataValue('warnings');
      if (raw === null || raw === undefined) return [];
      return parseJsonArray<ExportWarning>(raw, []);
    },
    set(this: any, val: any) {
      this.setDataValue('warnings', val ?? null);
    },
  })
  warnings: ExportWarning[];

  @Column({
    type: DataType.JSON,
    allowNull: true,
    get(this: any) {
      const raw = this.getDataValue('excluded');
      if (raw === null || raw === undefined) return [];
      return parseJsonArray<{ id: number; reason: string }>(raw, []);
    },
    set(this: any, val: any) {
      this.setDataValue('excluded', val ?? null);
    },
  })
  excluded: Array<{ id: number; reason: string }>;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    get(this: any) {
      const raw = this.getDataValue('manifest');
      if (raw === null || raw === undefined) return null;
      return parseJsonObject(raw, {});
    },
    set(this: any, val: any) {
      this.setDataValue('manifest', val ?? null);
    },
  })
  manifest: Record<string, unknown>;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  createdBy: number;

  @Column({ type: DataType.DATE, allowNull: false, field: 'created_at', defaultValue: DataType.NOW })
  createdAt: Date;
}
