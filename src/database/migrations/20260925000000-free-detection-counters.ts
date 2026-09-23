import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Counter atomik kuota 5x/jam tanpa login (MySQL saja, tanpa Redis).
 * Key: (identity, window_key) dengan window_key = jam kalender UTC 'YYYYMMDDHH'.
 * Enforcement memakai INSERT ... ON DUPLICATE KEY UPDATE yang atomik per baris,
 * sehingga check-then-insert yang lama (bocor saat konkuren) tidak dipakai lagi.
 */
export async function up(queryInterface: QueryInterface) {
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]));
  if (!names.includes('free_detection_counters')) {
    await queryInterface.createTable('free_detection_counters', {
      identity: { type: DataTypes.STRING(140), allowNull: false, primaryKey: true },
      window_key: { type: DataTypes.STRING(20), allowNull: false, primaryKey: true },
      count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.addIndex('free_detection_counters', ['updated_at']);
  }
}

export async function down(queryInterface: QueryInterface) {
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]));
  if (names.includes('free_detection_counters')) {
    await queryInterface.dropTable('free_detection_counters');
  }
}
