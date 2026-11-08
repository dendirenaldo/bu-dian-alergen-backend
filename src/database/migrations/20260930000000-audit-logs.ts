import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Tabel audit_logs untuk audit trail nyata modul dataset.
 * Idempoten: lewati bila tabel sudah ada. Down menghapus tabel.
 */
export async function up(queryInterface: QueryInterface) {
  const tables: string[] = await (queryInterface as any).showAllTables?.() ?? [];
  const names = tables.map((t: any) => (typeof t === 'string' ? t : t?.tableName ?? t?.name ?? ''));
  if (names.includes('audit_logs')) return;
  const desc: any = await queryInterface.describeTable('audit_logs').catch(() => null);
  if (desc && desc['id']) return;

  await queryInterface.createTable('audit_logs', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    action: { type: DataTypes.STRING(64), allowNull: false },
    actor_id: { type: DataTypes.INTEGER, allowNull: true },
    meta: { type: DataTypes.JSON, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await queryInterface.addIndex('audit_logs', ['action']);
  await queryInterface.addIndex('audit_logs', ['created_at']);
}

export async function down(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('audit_logs').catch(() => null);
  if (!desc || !desc['id']) return;
  await queryInterface.dropTable('audit_logs');
}
