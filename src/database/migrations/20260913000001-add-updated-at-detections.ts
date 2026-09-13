import { QueryInterface, DataTypes } from 'sequelize';

export async function up(queryInterface: QueryInterface) {
  // Model Detection memakai timestamps:true (underscored) sehingga
  // membutuhkan updated_at; migrasi awal hanya membuat created_at.
  const cols = await queryInterface.describeTable('detections');
  if (!cols['updated_at']) {
    await queryInterface.addColumn('detections', 'updated_at', {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    });
  }
}

export async function down(queryInterface: QueryInterface) {
  const cols = await queryInterface.describeTable('detections');
  if (cols['updated_at']) {
    await queryInterface.removeColumn('detections', 'updated_at');
  }
}
