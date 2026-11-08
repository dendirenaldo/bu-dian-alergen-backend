import { QueryInterface, DataTypes } from 'sequelize';

export async function up(queryInterface: QueryInterface) {
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
