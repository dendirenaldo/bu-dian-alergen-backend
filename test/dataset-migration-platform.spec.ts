/**
 * Harness migrasi platform pada SQLite: memastikan migration aditif,
 * mempertahankan data lama (status verified/source detection), dan idempoten.
 * Produksi MySQL tetap divalidasi manual saat deploy.
 */
import { Sequelize } from 'sequelize-typescript';
import { up as platformUp } from '../src/database/migrations/20261001000000-dataset-platform';
import { up as exportsUp } from '../src/database/migrations/20261001000001-dataset-exports';

describe('migrasi platform dataset', () => {
  let seq: Sequelize;
  beforeAll(async () => {
    seq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false } as any);
    const qi = seq.getQueryInterface();
    await qi.createTable('users', { id: { type: 'INTEGER', primaryKey: true, autoIncrement: true } as any });
    await qi.createTable('detections', { id: { type: 'INTEGER', primaryKey: true, autoIncrement: true } as any });
    await qi.createTable('dataset_items', {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true } as any,
      detection_id: { type: 'INTEGER', allowNull: true } as any,
      source: { type: 'TEXT', allowNull: false } as any,
      ocr_text: { type: 'TEXT', allowNull: true } as any,
      corrected_text: { type: 'TEXT', allowNull: true } as any,
      gold_label: { type: 'TEXT', allowNull: false } as any,
      corrected_allergens: { type: 'TEXT', allowNull: true } as any,
      status: { type: 'TEXT', allowNull: false } as any,
      verified_by: { type: 'INTEGER', allowNull: true } as any,
      verified_at: { type: 'DATE', allowNull: true } as any,
      notes: { type: 'TEXT', allowNull: true } as any,
      created_at: { type: 'DATE', allowNull: true } as any,
      updated_at: { type: 'DATE', allowNull: true } as any,
    });
    await seq.query(
      `INSERT INTO dataset_items (id, detection_id, source, ocr_text, corrected_text, gold_label, status, notes)
       VALUES (1, 7, 'detection', 'komposisi: susu', 'komposisi: susu bubuk', 'unsafe', 'verified', 'legacy')`,
    );
  });
  afterAll(async () => seq.close());

  test('kolom baru ditambah, data lama dipertahankan, status/source tetap valid', async () => {
    await platformUp(seq.getQueryInterface());
    const desc: any = await seq.getQueryInterface().describeTable('dataset_items');
    for (const col of ['product_name', 'image_url', 'ocr_status', 'quality_status', 'validation_errors', 'duplicate_hash', 'reviewed_by', 'acquisition_source']) {
      expect(desc[col]).toBeTruthy();
    }
    const [rows]: any = await seq.query(
      'SELECT detection_id, source, status, notes, corrected_text FROM dataset_items WHERE id = 1',
    );
    expect(rows[0]).toMatchObject({
      detection_id: 7,
      source: 'detection',
      status: 'verified',
      notes: 'legacy',
      corrected_text: 'komposisi: susu bubuk',
    });
  });

  test('migration idempoten dan tabel riwayat ekspor dibuat', async () => {
    await platformUp(seq.getQueryInterface());
    await exportsUp(seq.getQueryInterface());
    const desc: any = await seq.getQueryInterface().describeTable('dataset_exports');
    expect(desc['export_id']).toBeTruthy();
    expect(desc['manifest']).toBeTruthy();
  });
});
