/**
 * Regresi: kolom JSON harus bisa dikonsumsi frontend meski MariaDB
 * mengembalikannya sebagai LONGTEXT string.
 *
 * - Helper parse* menangani string/objek/array/null/string-rusak.
 * - Getter model (Detection.rawModelOutput, DatasetItem.correctedAllergens,
 *   AuditLog.meta) mem-parse string LONGTEXT secara transparan.
 * Model di-build tanpa koneksi DB (Model.build + addModels saja).
 */
import { Sequelize } from 'sequelize-typescript';
import {
  parseJsonArray,
  parseJsonField,
  parseJsonObject,
} from '../src/common/utils/json-field';
import { Detection } from '../src/modules/detections/models/detection.model';
import { DetectionAllergen } from '../src/modules/detections/models/detection-allergen.model';
import { FreeDetectionLog } from '../src/modules/detections/models/free-detection-log.model';
import { FreeDetectionCounter } from '../src/modules/detections/models/free-detection-counter.model';
import { Allergen } from '../src/modules/allergens/models/allergen.model';
import { Product } from '../src/modules/products/models/product.model';
import { ProductAllergen } from '../src/modules/products/models/product-allergen.model';
import { Ingredient } from '../src/modules/ingredients/models/ingredient.model';
import { Category } from '../src/modules/categories/models/category.model';
import { User } from '../src/modules/users/models/user.model';
import { EmailVerificationToken } from '../src/modules/auth/models/email-verification-token.model';
import { PasswordResetToken } from '../src/modules/auth/models/password-reset-token.model';
import { Content } from '../src/modules/contents/models/content.model';
import { Setting } from '../src/modules/settings/models/setting.model';
import { DatasetItem } from '../src/modules/dataset/models/dataset-item.model';
import { AuditLog } from '../src/modules/dataset/models/audit-log.model';

describe('parseJsonField (MariaDB LONGTEXT)', () => {
  test('objek/array diteruskan apa adanya; null/undefined → fallback', () => {
    const obj = { a: 1 };
    expect(parseJsonField(obj, {})).toBe(obj);
    const arr = [1, 2];
    expect(parseJsonField(arr, [])).toBe(arr);
    expect(parseJsonField(null, 'fb')).toBe('fb');
    expect(parseJsonField(undefined, 7)).toBe(7);
  });

  test('string JSON valid di-parse; string rusak/kosong → fallback', () => {
    expect(parseJsonField('{"x":1}', {})).toEqual({ x: 1 });
    expect(parseJsonField('[1,2]', [])).toEqual([1, 2]);
    expect(parseJsonField('  {"y":2}  ', {})).toEqual({ y: 2 });
    expect(parseJsonField('bukan-json', { d: 1 })).toEqual({ d: 1 });
    expect(parseJsonField('', 'fb')).toBe('fb');
    expect(parseJsonField('   ', 'fb')).toBe('fb');
  });

  test('parseJsonArray hanya menerima array', () => {
    expect(parseJsonArray('[1,2]')).toEqual([1, 2]);
    expect(parseJsonArray([{ n: 'x' }])).toEqual([{ n: 'x' }]);
    expect(parseJsonArray('{"a":1}', ['fb'])).toEqual(['fb']);
    expect(parseJsonArray(null)).toEqual([]);
  });

  test('parseJsonObject hanya menerima objek non-array', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject({ b: 2 })).toEqual({ b: 2 });
    expect(parseJsonObject('[1]', { fb: true })).toEqual({ fb: true });
    expect(parseJsonObject(null)).toEqual({});
  });
});

describe('getter model JSON (string LONGTEXT → objek/array)', () => {
  beforeAll(() => {
    const seq = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });
    seq.addModels([
      User,
      EmailVerificationToken,
      PasswordResetToken,
      Category,
      Product,
      ProductAllergen,
      Ingredient,
      Allergen,
      Detection,
      DetectionAllergen,
      FreeDetectionLog,
      FreeDetectionCounter,
      Content,
      Setting,
      DatasetItem,
      AuditLog,
    ]);
  });

  test('Detection.rawModelOutput: string → objek, objek tetap, null → {}', () => {
    const fromString = Detection.build({
      rawModelOutput: '{"model_name":"bert","allergens":[{"name":"Susu"}]}',
      result: 'unsafe',
      detectionMethod: 'text_input',
    } as any);
    expect(fromString.rawModelOutput).toEqual({ model_name: 'bert', allergens: [{ name: 'Susu' }] });

    const fromObject = Detection.build({
      rawModelOutput: { model_name: 'bilstm' },
      result: 'safe',
      detectionMethod: 'text_input',
    } as any);
    expect(fromObject.rawModelOutput).toEqual({ model_name: 'bilstm' });

    const fromNull = Detection.build({ result: 'safe', detectionMethod: 'text_input' } as any);
    expect(fromNull.rawModelOutput).toEqual({});
  });

  test('DatasetItem.correctedAllergens: string → array, null tetap null', () => {
    const fromString = DatasetItem.build({
      correctedAllergens: '[{"name":"Susu","severity":"high","confidence":0.9}]',
      goldLabel: 'unsafe',
    } as any);
    expect(fromString.correctedAllergens).toEqual([{ name: 'Susu', severity: 'high', confidence: 0.9 }]);

    const fromNull = DatasetItem.build({ goldLabel: 'safe' } as any);
    expect(fromNull.correctedAllergens).toBeNull();
  });

  test('AuditLog.meta: string → objek, null tetap null', () => {
    const fromString = AuditLog.build({ action: 'dataset.export', meta: '{"count":3}' } as any);
    expect(fromString.meta).toEqual({ count: 3 });

    const fromNull = AuditLog.build({ action: 'dataset.export' } as any);
    expect(fromNull.meta).toBeNull();
  });

  test('setter menerima objek/array lalu getter mengembalikan nilai setara', () => {
    const d = Detection.build({ result: 'safe', detectionMethod: 'text_input' } as any);
    d.rawModelOutput = { hello: 'world' };
    expect(d.rawModelOutput).toEqual({ hello: 'world' });

    const item = DatasetItem.build({ goldLabel: 'safe' } as any);
    item.correctedAllergens = [{ name: 'Telur', severity: 'medium', confidence: 0.5 }] as any;
    expect(item.correctedAllergens).toEqual([{ name: 'Telur', severity: 'medium', confidence: 0.5 }]);
  });
});
