import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Satu deteksi = maksimal satu record dataset.
 *
 * Sebelum menambah unique index, duplikat lama (jika ada) dilepas tautannya
 * dengan detection_id=NULL — record tetap disimpan, tidak ada penghapusan.
 * Idempoten: aman dijalankan ulang.
 */
export async function up(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('dataset_items').catch(() => null);
  if (!desc || !desc['id']) return;

  try {
    const [dups]: any = await queryInterface.sequelize.query(
      `SELECT detection_id, MIN(id) AS keep_id
         FROM dataset_items
        WHERE detection_id IS NOT NULL
        GROUP BY detection_id
       HAVING COUNT(*) > 1`,
    );
    for (const row of Array.isArray(dups) ? dups : []) {
      const detectionId = Number((row as any).detection_id);
      const keepId = Number((row as any).keep_id);
      if (!Number.isFinite(detectionId) || !Number.isFinite(keepId)) continue;
      await queryInterface.sequelize.query(
        `UPDATE dataset_items
            SET detection_id = NULL
          WHERE detection_id = :detectionId AND id <> :keepId`,
        { replacements: { detectionId, keepId } },
      );
    }
  } catch {
    /* tabel kosong / dialek tanpa subquery — lanjut ke index */
  }

  try {
    await queryInterface.addIndex('dataset_items', ['detection_id'], {
      name: 'dataset_items_detection_id_unique',
      unique: true,
    });
  } catch {
    /* index sudah ada */
  }
}

export async function down(queryInterface: QueryInterface) {
  try {
    await queryInterface.removeIndex('dataset_items', 'dataset_items_detection_id_unique');
  } catch {
    /* tidak ada */
  }
  void DataTypes;
}
