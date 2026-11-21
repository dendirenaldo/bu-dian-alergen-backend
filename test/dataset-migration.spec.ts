/**
 * Migrasi unique detection_id: duplikat lama dilepas tautannya (data tetap),
 * index unik mencegah record ganda untuk satu deteksi, dan up() idempoten.
 *
 * Dijalankan pada SQLite in-memory sebagai harness migrasi; produksi MySQL.
 */
import { Sequelize } from 'sequelize-typescript';
import { up, down } from '../src/database/migrations/20261001000002-dataset-detection-unique';

describe('migrasi dataset detection_id unik', () => {
  let seq: Sequelize;
  beforeAll(async () => {
    seq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false } as any);
    const qi = seq.getQueryInterface();
    await qi.createTable('dataset_items', {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true } as any,
      detection_id: { type: 'INTEGER', allowNull: true } as any,
      notes: { type: 'TEXT', allowNull: true } as any,
      created_at: { type: 'DATE', allowNull: true } as any,
      updated_at: { type: 'DATE', allowNull: true } as any,
    });
    await seq.query(`INSERT INTO dataset_items (id, detection_id, notes) VALUES
      (1, 10, 'keep'), (2, 10, 'dup'), (3, 11, 'other'), (4, NULL, 'none')`);
  });

  afterAll(async () => {
    await seq.close();
  });

  test('up() melepas duplikat tanpa menghapus record dan menambah index unik', async () => {
    const qi = seq.getQueryInterface();
    await up(qi);
    const [rows]: any = await seq.query('SELECT id, detection_id, notes FROM dataset_items ORDER BY id');
    expect(rows.map((r: any) => r.detection_id)).toEqual([10, null, 11, null]);
    expect(rows.map((r: any) => r.notes)).toEqual(['keep', 'dup', 'other', 'none']);

    await expect(
      seq.query(`INSERT INTO dataset_items (id, detection_id) VALUES (5, 10)`),
    ).rejects.toBeTruthy();
  });

  test('up() idempoten dan down() melepas index', async () => {
    const qi = seq.getQueryInterface();
    await up(qi);
    await up(qi);
    await down(qi);
    // Setelah index dilepas, duplikat baru boleh masuk lagi.
    await seq.query(`INSERT INTO dataset_items (id, detection_id) VALUES (6, 10)`);
    const [rows]: any = await seq.query('SELECT COUNT(*) AS c FROM dataset_items WHERE detection_id = 10');
    expect(Number(rows[0].c)).toBe(2);
  });
});
