import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Perbaikan FK detections.user_id -> users.id yang hilang akibat changeColumn
 * pada migrasi 20260923000000 (changeColumn MySQL tidak mempertahankan FK).
 * Idempoten: lewati bila constraint sudah ada.
 */
export async function up(queryInterface: QueryInterface) {
  // Pastikan kolom nullable (anonim) + ada index.
  const cols = await queryInterface.describeTable('detections');
  if (cols['user_id'] && (cols['user_id'] as any).allowNull === false) {
    await queryInterface.changeColumn('detections', 'user_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  const constraints = (await (queryInterface as any).showConstraint('detections')) as any[];
  const fkNames = new Set(
    (constraints || [])
      .filter((c) => c.constraintType === 'FOREIGN KEY' && String(c.columnName || '').toLowerCase() === 'user_id')
      .map((c) => c.constraintName),
  );
  if (fkNames.size === 0) {
    try {
      await queryInterface.addConstraint('detections', {
        fields: ['user_id'],
        type: 'foreign key',
        name: 'detections_user_id_users_fk',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    } catch (e) {
      // Baris yatim (user terhapus) menggagalkan FK — biarkan error terlihat.
      throw e;
    }
  }
}

export async function down(queryInterface: QueryInterface) {
  const constraints = (await (queryInterface as any).showConstraint('detections')) as any[];
  const fk = (constraints || []).find(
    (c) => c.constraintType === 'FOREIGN KEY' && String(c.columnName || '').toLowerCase() === 'user_id',
  );
  if (fk?.constraintName) {
    await queryInterface.removeConstraint('detections', fk.constraintName);
  }
}
