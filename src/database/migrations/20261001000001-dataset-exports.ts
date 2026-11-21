import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Riwayat ekspor dataset — snapshot konfigurasi + berkas ZIP yang dihasilkan.
 * Idempoten (lewati bila tabel sudah ada).
 */
export async function up(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('dataset_exports').catch(() => null);
  if (desc && desc['id']) return;

  await queryInterface.createTable('dataset_exports', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    export_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    profile: { type: DataTypes.STRING(40), allowNull: false },
    format: { type: DataTypes.STRING(16), allowNull: false },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'completed' },
    record_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    image_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    bytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    filename: { type: DataTypes.STRING(255), allowNull: true },
    checksum: { type: DataTypes.STRING(64), allowNull: true },
    file_path: { type: DataTypes.STRING(500), allowNull: true },
    config: { type: DataTypes.JSON, allowNull: true },
    warnings: { type: DataTypes.JSON, allowNull: true },
    excluded: { type: DataTypes.JSON, allowNull: true },
    manifest: { type: DataTypes.JSON, allowNull: true },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await queryInterface.addIndex('dataset_exports', ['export_id'], { name: 'dataset_exports_export_id' });
  await queryInterface.addIndex('dataset_exports', ['created_at'], { name: 'dataset_exports_created_at' });
}

export async function down(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('dataset_exports').catch(() => null);
  if (!desc || !desc['id']) return;
  await queryInterface.dropTable('dataset_exports');
}
