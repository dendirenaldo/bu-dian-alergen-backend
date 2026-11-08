import { Table, Column, Model, DataType } from 'sequelize-typescript';
import { parseJsonObject } from '../../../common/utils/json-field';

@Table({ tableName: 'audit_logs', timestamps: false, underscored: true })
export class AuditLog extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  id: number;

  @Column({ type: DataType.STRING(64), allowNull: false })
  action: string;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'actor_id' })
  actorId: number | null;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    // MariaDB mengembalikan JSON sebagai LONGTEXT string — parse defensif.
    get(this: any) {
      const raw = this.getDataValue('meta');
      if (raw === null || raw === undefined) return null;
      return parseJsonObject(raw, {});
    },
    set(this: any, val: any) {
      this.setDataValue('meta', val ?? null);
    },
  })
  meta: Record<string, unknown> | null;

  @Column({ type: DataType.DATE, allowNull: false, field: 'created_at', defaultValue: DataType.NOW })
  createdAt: Date;
}
