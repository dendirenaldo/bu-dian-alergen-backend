import { Table, Column, Model, DataType } from 'sequelize-typescript';

/**
 * Counter kuota deteksi tanpa login per jendela jam kalender (UTC).
 * Satu baris per identitas per jam: 'ip:<hash>' atau 'anon:<uuid>'.
 * Increment memakai statement atomik tunggal (INSERT ... ON DUPLICATE KEY
 * UPDATE) sehingga aman dari race antar koneksi pool tanpa lock/transaksi.
 */
@Table({ tableName: 'free_detection_counters', timestamps: false })
export class FreeDetectionCounter extends Model {
  @Column({ type: DataType.STRING(140), primaryKey: true, field: 'identity' })
  identity: string;

  @Column({ type: DataType.STRING(20), primaryKey: true, field: 'window_key' })
  windowKey: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'count' })
  count: number;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'updated_at' })
  updatedAt: Date;
}
