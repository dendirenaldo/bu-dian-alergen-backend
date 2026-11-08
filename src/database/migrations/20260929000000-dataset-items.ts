import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Tabel dataset_items untuk kurasi dataset training (word2vec + BiLSTM).
 * Idempoten: lewati bila tabel sudah ada (describeTable guard).
 */
export async function up(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('dataset_items').catch(() => null);
  if (desc && desc['id']) return;

  await queryInterface.createTable('dataset_items', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    detection_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'detections', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    source: {
      type: DataTypes.ENUM('detection', 'manual'),
      allowNull: false,
      defaultValue: 'detection',
    },
    ocr_text: { type: DataTypes.TEXT, allowNull: true },
    corrected_text: { type: DataTypes.TEXT, allowNull: true },
    gold_label: {
      type: DataTypes.ENUM('safe', 'unsafe'),
      allowNull: false,
    },
    corrected_allergens: { type: DataTypes.JSON, allowNull: true },
    status: {
      type: DataTypes.ENUM('draft', 'verified'),
      allowNull: false,
      defaultValue: 'draft',
    },
    verified_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    verified_at: { type: DataTypes.DATE, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await queryInterface.addIndex('dataset_items', ['status', 'gold_label', 'detection_id']);
}

export async function down(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('dataset_items').catch(() => null);
  if (!desc || !desc['id']) return;
  await queryInterface.dropTable('dataset_items');
}
