import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Fase 1 SSE: detection_method menyimpan suffix model dari ML
 * (mis. image_ocr_bert, text_input_ensemble), jadi ubah ENUM -> STRING.
 */
export async function up(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('detections').catch(() => null);
  if (!desc || !desc['detection_method']) return;
  await queryInterface.changeColumn('detections', 'detection_method', {
    type: DataTypes.STRING(32),
    allowNull: false,
  });
}

export async function down(queryInterface: QueryInterface) {
  await queryInterface.changeColumn('detections', 'detection_method', {
    type: DataTypes.ENUM('image_ocr', 'text_input'),
    allowNull: false,
  });
}
