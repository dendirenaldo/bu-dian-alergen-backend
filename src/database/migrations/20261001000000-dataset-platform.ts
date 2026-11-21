import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Fase platform dataset: metadata lengkap, alur review, kualitas, provenance.
 *
 * Non-destruktif & idempoten:
 * - Kolom baru hanya ditambah bila belum ada.
 * - status/source diubah ENUM -> VARCHAR agar status workflow baru
 *   (pending_review, needs_correction, approved, rejected, archived) dapat
 *   disimpan tanpa ALTER ENUM setiap kali domain berubah.
 * - Nilai lama (draft/verified/detection/manual) tetap valid → backward compatible.
 */
export async function up(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('dataset_items').catch(() => null);
  if (!desc || !desc['id']) return; // tabel dibuat migration 20260929

  const add = async (name: string, definition: any) => {
    if (!desc[name]) await queryInterface.addColumn('dataset_items', name, definition);
  };

  const S = (len = 255) => ({ type: DataTypes.STRING(len), allowNull: true });

  // Identitas produk
  await add('product_name', S(255));
  await add('brand', S(255));
  await add('category', S(120));
  await add('barcode', S(64));

  // Metadata gambar
  await add('image_url', S(500));
  await add('image_type', S(32));
  await add('image_mime', S(100));
  await add('image_size', { type: DataTypes.INTEGER, allowNull: true });
  await add('image_width', { type: DataTypes.INTEGER, allowNull: true });
  await add('image_height', { type: DataTypes.INTEGER, allowNull: true });
  await add('image_checksum', S(64));
  await add('original_filename', S(255));
  await add('stored_filename', S(255));

  // OCR
  await add('ocr_engine', S(64));
  await add('ocr_engine_version', S(32));
  await add('ocr_status', S(32));
  await add('ocr_error', { type: DataTypes.TEXT, allowNull: true });
  await add('ocr_processed_at', { type: DataTypes.DATE, allowNull: true });

  // Ingredien
  await add('ingredient_text', { type: DataTypes.TEXT, allowNull: true });
  await add('normalized_ingredients', { type: DataTypes.JSON, allowNull: true });
  await add('extraction_method', S(32));

  // Akuisisi & provenance
  await add('acquisition_source', S(32));
  await add('acquisition_context', S(32));
  await add('source_app_version', S(64));
  await add('submitted_by', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  await add('submitted_at', { type: DataTypes.DATE, allowNull: true });

  // Anotasi
  await add('annotation_source', S(32));
  await add('annotation_version', S(32));
  await add('annotation_schema_version', S(32));
  await add('annotator_id', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  await add('annotated_at', { type: DataTypes.DATE, allowNull: true });

  // Kualitas & review
  await add('quality_status', { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'unassessed' });
  await add('validation_errors', { type: DataTypes.JSON, allowNull: true });
  await add('export_eligible', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
  await add('duplicate_of', { type: DataTypes.INTEGER, allowNull: true });
  await add('duplicate_hash', S(64));
  await add('review_note', { type: DataTypes.TEXT, allowNull: true });
  await add('reviewed_by', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  await add('reviewed_at', { type: DataTypes.DATE, allowNull: true });

  // ENUM -> VARCHAR (idempoten; aman bila sudah VARCHAR).
  try {
    await queryInterface.changeColumn('dataset_items', 'status', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'draft',
    });
  } catch {
    /* sudah VARCHAR / dialek tanpa ALTER ENUM */
  }
  try {
    await queryInterface.changeColumn('dataset_items', 'source', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'detection',
    });
  } catch {
    /* sudah VARCHAR */
  }

  const indexes: Array<[string, string[]]> = [
    ['dataset_items_status', ['status']],
    ['dataset_items_source', ['source']],
    ['dataset_items_acquisition_source', ['acquisition_source']],
    ['dataset_items_category', ['category']],
    ['dataset_items_gold_label', ['gold_label']],
    ['dataset_items_image_checksum', ['image_checksum']],
    ['dataset_items_duplicate_hash', ['duplicate_hash']],
  ];
  for (const [name, cols] of indexes) {
    try {
      await queryInterface.addIndex('dataset_items', cols, { name });
    } catch {
      /* index sudah ada */
    }
  }
}

export async function down(queryInterface: QueryInterface) {
  const desc: any = await queryInterface.describeTable('dataset_items').catch(() => null);
  if (!desc || !desc['id']) return;
  const drop = async (name: string) => {
    if (desc[name]) await queryInterface.removeColumn('dataset_items', name);
  };
  for (const col of [
    'product_name', 'brand', 'category', 'barcode',
    'image_url', 'image_type', 'image_mime', 'image_size', 'image_width', 'image_height',
    'image_checksum', 'original_filename', 'stored_filename',
    'ocr_engine', 'ocr_engine_version', 'ocr_status', 'ocr_error', 'ocr_processed_at',
    'ingredient_text', 'normalized_ingredients', 'extraction_method',
    'acquisition_source', 'acquisition_context', 'source_app_version', 'submitted_by', 'submitted_at',
    'annotation_source', 'annotation_version', 'annotation_schema_version', 'annotator_id', 'annotated_at',
    'quality_status', 'validation_errors', 'export_eligible', 'duplicate_of', 'duplicate_hash',
    'review_note', 'reviewed_by', 'reviewed_at',
  ]) {
    await drop(col);
  }
  // Nilai status baru tidak valid di ENUM lama → normalisasi sebelum revert.
  try {
    await queryInterface.sequelize.query(
      "UPDATE dataset_items SET status='draft' WHERE status NOT IN ('draft','verified')",
    );
    await queryInterface.changeColumn('dataset_items', 'status', {
      type: DataTypes.ENUM('draft', 'verified'),
      allowNull: false,
      defaultValue: 'draft',
    });
  } catch {
    /* abaikan */
  }
}
