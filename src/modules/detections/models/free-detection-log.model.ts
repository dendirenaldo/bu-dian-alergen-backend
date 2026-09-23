import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'free_detection_logs', timestamps: false, underscored: true })
export class FreeDetectionLog extends Model {
  @Column({ type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(64), allowNull: false })
  ipHash: string;

  @Column({ type: DataType.STRING(36), allowNull: true })
  anonId: string;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'text' })
  endpoint: string;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'bert' })
  model: string;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  createdAt: Date;
}
