import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Free detection tanpa login (maks 5x/jam) + pilihan model.
 * - detections.user_id -> nullable (anonim disimpan dengan user_id NULL)
 * - kolom anon tracking: anon_id, ip_hash, is_guest, model_name
 * - tabel free_detection_logs sebagai audit deteksi yang selesai
 *   (enforcement kuota memakai free_detection_counters yang atomik —
 *   lihat 20260925000000-free-detection-counters.ts)
 */
export async function up(queryInterface: QueryInterface) {
  const cols = await queryInterface.describeTable('detections');

  if (cols['user_id'] && (cols['user_id'] as any).allowNull === false) {
    // MySQL: ubah menjadi nullable. FK dipertahankan via changeColumn.
    await queryInterface.changeColumn('detections', 'user_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  if (!cols['anon_id']) {
    await queryInterface.addColumn('detections', 'anon_id', {
      type: DataTypes.STRING(36),
      allowNull: true,
    });
  }
  if (!cols['ip_hash']) {
    await queryInterface.addColumn('detections', 'ip_hash', {
      type: DataTypes.STRING(64),
      allowNull: true,
    });
  }
  if (!cols['is_guest']) {
    await queryInterface.addColumn('detections', 'is_guest', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }
  if (!cols['model_name']) {
    await queryInterface.addColumn('detections', 'model_name', {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'bert',
    });
  }

  try {
    await queryInterface.addIndex('detections', ['anon_id']);
  } catch { /* index sudah ada */ }
  try {
    await queryInterface.addIndex('detections', ['is_guest']);
  } catch { /* index sudah ada */ }

  // Tabel quota anonim: satu baris per percobaan (termasuk yang gagal ML? tidak — hanya sukses).
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]));
  if (!names.includes('free_detection_logs')) {
    await queryInterface.createTable('free_detection_logs', {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      ip_hash: { type: DataTypes.STRING(64), allowNull: false },
      anon_id: { type: DataTypes.STRING(36), allowNull: true },
      endpoint: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'text' },
      model: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'bert' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.addIndex('free_detection_logs', ['ip_hash', 'created_at']);
    await queryInterface.addIndex('free_detection_logs', ['anon_id', 'created_at']);
    await queryInterface.addIndex('free_detection_logs', ['created_at']);
  }
}

export async function down(queryInterface: QueryInterface) {
  // Tolak rollback bila masih ada data tamu — mengembalikan NOT NULL akan gagal.
  const [rows] = (await queryInterface.sequelize.query(
    'SELECT COUNT(*) AS cnt FROM detections WHERE user_id IS NULL',
  )) as any[];
  if (Number(rows?.[0]?.cnt || 0) > 0) {
    throw new Error('Rollback dibatalkan: masih ada baris detections anonim (user_id NULL)');
  }
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]));
  if (names.includes('free_detection_logs')) {
    await queryInterface.dropTable('free_detection_logs');
  }
  const cols = await queryInterface.describeTable('detections');
  for (const c of ['model_name', 'is_guest', 'ip_hash', 'anon_id']) {
    if (cols[c]) await queryInterface.removeColumn('detections', c);
  }
  // user_id dikembalikan NOT NULL hanya bila tidak ada baris anonim tersisa.
  await queryInterface.changeColumn('detections', 'user_id', {
    type: DataTypes.INTEGER,
    allowNull: false,
  });
}
