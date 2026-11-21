/**
 * Unit: validasi record dataset (backend otoritatif).
 * Fokus pada semantik alergen, konflik label, dan kelengkapan workflow.
 */
import {
  allergenLabelSet,
  computeValidationIssues,
  normalizeAllergens,
  positiveAllergens,
  qualityFromIssues,
  slugify,
} from '../src/modules/dataset/dataset-validation.service';
import { canTransition } from '../src/modules/dataset/dataset.constants';

function record(overrides: Record<string, any> = {}): any {
  return {
    id: 1,
    status: 'draft',
    productName: 'Biskuit Cokelat',
    ocrText: 'komposisi: tepung terigu, gula, susu bubuk, kacang tanah',
    correctedText: 'komposisi: tepung terigu, gula, susu bubuk, kacang tanah',
    ingredientText: 'tepung terigu, gula, susu bubuk, kacang tanah',
    goldLabel: 'unsafe',
    correctedAllergens: [
      { name: 'Susu', severity: 'medium', confidence: 0.9, presence: 'present' },
      { name: 'Kacang', severity: 'high', confidence: 0.95, presence: 'present' },
    ],
    imageUrl: '/uploads/x.jpg',
    ocrStatus: 'processed',
    annotationSource: 'human',
    ...overrides,
  };
}

describe('validasi dataset', () => {
  test('record lengkap → tanpa isu, kualitas ok', () => {
    const issues = computeValidationIssues(record(), { requireComplete: true });
    expect(issues).toEqual([]);
    expect(qualityFromIssues(issues)).toBe('ok');
  });

  test('label aman + alergen positif → error LABEL_CONFLICT', () => {
    const issues = computeValidationIssues(record({ goldLabel: 'safe' }), { requireComplete: true });
    const conflict = issues.find((i) => i.code === 'LABEL_CONFLICT');
    expect(conflict?.severity).toBe('error');
    expect(qualityFromIssues(issues)).toBe('error');
  });

  test('tidak aman tanpa alergen positif → warning LABEL_WITHOUT_EVIDENCE', () => {
    const issues = computeValidationIssues(
      record({ correctedAllergens: [{ name: 'Susu', presence: 'absent', severity: 'low', confidence: 0.5 }] }),
      { requireComplete: true },
    );
    expect(issues.find((i) => i.code === 'LABEL_WITHOUT_EVIDENCE')?.severity).toBe('warning');
    expect(issues.find((i) => i.code === 'MISSING_ANNOTATION')).toBeUndefined();
  });

  test('anotasi kosong saat review → error MISSING_ANNOTATION (tidak diasumsikan aman)', () => {
    const issues = computeValidationIssues(
      record({ correctedAllergens: [], goldLabel: 'safe', status: 'pending_review' }),
      { requireComplete: true },
    );
    expect(issues.find((i) => i.code === 'MISSING_ANNOTATION')?.severity).toBe('error');
  });

  test('alergen di luar master → error UNKNOWN_ALLERGEN', () => {
    const issues = computeValidationIssues(record(), {
      requireComplete: true,
      knownAllergens: new Set(['Susu']),
    });
    expect(issues.some((i) => i.code === 'UNKNOWN_ALLERGEN' && i.severity === 'error')).toBe(true);
  });

  test('teks kosong saat review → error MISSING_TEXT', () => {
    const issues = computeValidationIssues(record({ ocrText: '', correctedText: '' }), {
      requireComplete: true,
    });
    expect(issues.find((i) => i.code === 'MISSING_TEXT')?.severity).toBe('error');
  });

  test('presence may_contain dihitung positif untuk multilabel', () => {
    const r = record({
      goldLabel: 'unsafe',
      correctedAllergens: [{ name: 'Kacang', severity: 'high', confidence: 0.7, presence: 'may_contain' }],
    });
    expect(positiveAllergens(r).map((a) => a.name)).toEqual(['Kacang']);
    expect(allergenLabelSet(r)).toEqual(['allergen_kacang', 'unsafe']);
  });

  test('normalizeAllergens mengisi default presence & menjepit confidence', () => {
    const out = normalizeAllergens([
      { name: ' Susu ', severity: 'invalid', confidence: 2 },
      { name: '' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Susu', severity: 'medium', confidence: 1, presence: 'present' });
  });

  test('slugify stabil untuk label alergen', () => {
    expect(slugify('Gluten (gandum)')).toBe('gluten_gandum');
    expect(slugify('  Kacang Tanah ')).toBe('kacang_tanah');
  });

  test('transisi status tidak sah ditolak, sah diterima', () => {
    expect(canTransition('draft', 'pending_review')).toBe(true);
    expect(canTransition('pending_review', 'approved')).toBe(true);
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('approved', 'needs_correction')).toBe(true);
    expect(canTransition('archived', 'draft')).toBe(true);
    expect(canTransition('rejected', 'verified')).toBe(false);
  });
});
