/**
 * E2E platform dataset: admin create → image upload → submit review → approve →
 * statistik/filter → pratinjau & ekspor berprofil → riwayat/unduh → RBAC.
 * DB SQLite in-memory; ML service tidak terlibat.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SequelizeModule, getModelToken } from '@nestjs/sequelize';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import request = require('supertest');

import { AuthModule } from '../src/modules/auth/auth.module';
import { UsersModule } from '../src/modules/users/users.module';
import { CategoriesModule } from '../src/modules/categories/categories.module';
import { ProductsModule } from '../src/modules/products/products.module';
import { IngredientsModule } from '../src/modules/ingredients/ingredients.module';
import { AllergensModule } from '../src/modules/allergens/allergens.module';
import { DetectionsModule } from '../src/modules/detections/detections.module';
import { DatasetModule } from '../src/modules/dataset/dataset.module';
import { ContentsModule } from '../src/modules/contents/contents.module';
import { DashboardModule } from '../src/modules/dashboard/dashboard.module';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { User } from '../src/modules/users/models/user.model';
import { Allergen } from '../src/modules/allergens/models/allergen.model';
import { DatasetExport } from '../src/modules/dataset/models/dataset-export.model';
import { Detection } from '../src/modules/detections/models/detection.model';
import { AllExceptionsFilter } from '../src/common/filters/validation-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('E2E platform dataset', () => {
  let app: INestApplication;
  let userRepo: typeof User;
  let allergenRepo: typeof Allergen;
  let exportRepo: typeof DatasetExport;
  let detectionRepo: typeof Detection;
  let normalUserId = 0;
  let adminToken = '';
  let userToken = '';
  let itemId = 0;
  let duplicateId = 0;
  let exportId = 0;

  const admin = { name: 'Admin Dataset', email: 'dsadmin@e2e.id', password: 'Password123' };
  const normal = { name: 'User Biasa', email: 'dsuser@e2e.id', password: 'Password123' };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        SequelizeModule.forRoot({
          dialect: 'sqlite',
          storage: ':memory:',
          autoLoadModels: true,
          synchronize: true,
          logging: false,
          define: { timestamps: true, underscored: true },
        }),
        AuthModule,
        UsersModule,
        CategoriesModule,
        ProductsModule,
        IngredientsModule,
        AllergensModule,
        DetectionsModule,
        DatasetModule,
        ContentsModule,
        DashboardModule,
        SettingsModule,
      ],
    })
      .overrideProvider(require('@nestjs/config').ConfigService)
      .useValue({ get: (key: string, fallback?: unknown) => process.env[key] ?? fallback })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    userRepo = module.get<typeof User>(getModelToken(User));
    allergenRepo = module.get<typeof Allergen>(getModelToken(Allergen));
    exportRepo = module.get<typeof DatasetExport>(getModelToken(DatasetExport));
    detectionRepo = module.get<typeof Detection>(getModelToken(Detection));

    for (const u of [admin, normal]) {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(u);
    }
    await userRepo.update({ role: 'admin', emailVerifiedAt: new Date() } as any, {
      where: { email: admin.email },
    });
    await userRepo.update({ emailVerifiedAt: new Date() } as any, { where: { email: normal.email } });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });
    adminToken = adminLogin.body.data.token;
    const userLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: normal.email, password: normal.password });
    userToken = userLogin.body.data.token;
    const normalRow = await userRepo.findOne({ where: { email: normal.email } });
    normalUserId = (normalRow as any).id;

    await allergenRepo.create({ name: 'Susu', code: 'SUSU', severityLevel: 'medium' } as any);
    await allergenRepo.create({ name: 'Kacang', code: 'KACANG', severityLevel: 'high' } as any);
  });

  afterAll(async () => {
    // Bersihkan artefak ZIP yang dibuat test (bukan bagian deliverable).
    try {
      const rows: any[] = await exportRepo.findAll();
      for (const r of rows) {
        const p = r.filePath;
        if (p && existsSync(p)) unlinkSync(p);
      }
    } catch {
      /* abaikan */
    }
    if (app) await app.close();
  });

  const createPayload = (overrides: Record<string, any> = {}) => ({
    product_name: 'Biskuit Cokelat Uji',
    brand: 'Bu Dian',
    category: 'Snack',
    ocr_text: 'komposisi: tepung terigu, gula, susu bubuk, kacang tanah',
    corrected_text: 'komposisi: tepung terigu, gula, susu bubuk, kacang tanah',
    ingredient_text: 'tepung terigu, gula, susu bubuk, kacang tanah',
    normalized_ingredients: ['tepung terigu', 'gula', 'susu bubuk', 'kacang tanah'],
    gold_label: 'unsafe',
    corrected_allergens: [
      { name: 'Susu', severity: 'medium', confidence: 0.9, presence: 'present' },
      { name: 'Kacang', severity: 'high', confidence: 0.95, presence: 'present' },
    ],
    acquisition_source: 'admin_manual',
    annotation_source: 'human',
    image_type: 'ingredient_label',
    ocr_engine: 'tesseract',
    ...overrides,
  });

  it('RBAC: user biasa tidak boleh akses dataset', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/dataset-items')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    const unauth = await request(app.getHttpServer()).get('/api/v1/dataset-items');
    expect(unauth.status).toBe(401);
  });

  it('admin membuat record dataset manual (draft) → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload());
    expect([200, 201]).toContain(res.status);
    itemId = res.body.data.id;
    expect(itemId).toBeGreaterThan(0);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.productName).toBe('Biskuit Cokelat Uji');
    expect(res.body.data.acquisitionSource).toBe('admin_manual');
    expect(res.body.data.duplicateOf).toBeNull();
    expect(Array.isArray(res.body.data.validationErrors)).toBe(true);
  });

  it('alergen di luar master ditolak 422 UNKNOWN_ALLERGEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        createPayload({
          corrected_allergens: [{ name: 'Naga', severity: 'low', confidence: 0.5 }],
        }),
      );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNKNOWN_ALLERGEN');
  });

  it('unggah gambar → checksum, dimensi, URL tersimpan', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/dataset-items/${itemId}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('image_type', 'ingredient_label')
      .attach('image', PNG_1PX, { filename: 'label.png', contentType: 'image/png' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.imageUrl).toMatch(/^\/uploads\//);
    expect(res.body.data.imageChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.data.imageWidth).toBe(1);
    expect(res.body.data.imageType).toBe('ingredient_label');
  });

  it('submit review valid → pending_review', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/dataset-items/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'pending_review' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending_review');
    expect(res.body.data.qualityStatus).toBe('ok');
  });

  it('duplikat teks terdeteksi (warning, bukan blokir)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload({ product_name: 'Biskuit Duplikat' }));
    expect([200, 201]).toContain(res.status);
    duplicateId = res.body.data.id;
    expect(res.body.data.duplicateOf).toBe(itemId);
    expect(
      (res.body.data.validationErrors ?? []).some((e: any) => e.code === 'DUPLICATE_RECORD'),
    ).toBe(true);
  });

  it('review approve → approved + metadata reviewer', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/dataset-items/${itemId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve', note: 'Lengkap dan konsisten' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.verifiedAt).toBeTruthy();
    expect(res.body.data.reviewedAt).toBeTruthy();
    expect(res.body.data.reviewNote).toBe('Lengkap dan konsisten');
  });

  it('riwayat audit record dapat dibaca admin', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/dataset-items/${itemId}/history`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((e: any) => e.action === 'dataset.create')).toBe(true);
    expect(res.body.data.some((e: any) => e.action === 'dataset.approve' || e.action === 'dataset.review')).toBe(true);
  });

  it('transisi status tidak sah → 409 INVALID_STATUS_TRANSITION', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/dataset-items/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'pending_review' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('statistik operasional akurat', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/dataset-items/statistics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.totals.total).toBe(2);
    expect(data.totals.approved).toBe(1);
    expect(data.totals.draft).toBe(1);
    expect(data.totals.duplicates).toBe(1);
    expect(data.totals.exportable).toBe(1);
    expect(data.allergenDistribution.map((a: any) => a.name)).toEqual(
      expect.arrayContaining(['Susu', 'Kacang']),
    );
    expect(data.growth).toHaveLength(14);
  });

  it('filter status ganda, pencarian, dan quality berfungsi', async () => {
    const byStatus = await request(app.getHttpServer())
      .get('/api/v1/dataset-items?status=approved,draft&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.total).toBe(2);

    const bySearch = await request(app.getHttpServer())
      .get('/api/v1/dataset-items?search=Duplikat')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.total).toBe(1);
    expect(bySearch.body.data[0].id).toBe(duplicateId);

    const byQuality = await request(app.getHttpServer())
      .get('/api/v1/dataset-items?quality=ok')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byQuality.status).toBe(200);
    expect(byQuality.body.total).toBeGreaterThanOrEqual(1);
  });

  it('pratinjau ekspor NLP: seleksi, label, split, integritas', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items/exports/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ profile: 'nlp', status: 'approved', includeImages: false });
    expect([200, 201]).toContain(res.status);
    const data = res.body.data;
    expect(data.profile).toBe('nlp');
    expect(data.counts.eligible).toBe(1);
    expect(data.counts.labels.unsafe).toBe(1);
    expect(data.split.counts.total).toBe(1);
    expect(data.integrity.auditPassed).toBe(true);
    expect(data.allergenDistribution.map((a: any) => a.name)).toEqual(
      expect.arrayContaining(['Susu', 'Kacang']),
    );
  });

  it('filter status koma dan pratinjau ekspor multi-status diterima', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/dataset-items?status=approved,verified&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);

    const preview = await request(app.getHttpServer())
      .post('/api/v1/dataset-items/exports/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ profile: 'nlp', status: 'approved,verified', includeImages: false });
    expect([200, 201]).toContain(preview.status);
    expect(preview.body.data.counts.eligible).toBeGreaterThanOrEqual(1);
  });

  it('ekspor NLP menghasilkan ZIP + manifest + riwayat', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items/exports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        profile: 'nlp',
        format: 'jsonl',
        status: 'approved',
        includeImages: false,
        seed: 42,
        trainRatio: 0.7,
        validationRatio: 0.15,
        testRatio: 0.15,
      });
    expect([200, 201]).toContain(res.status);
    const data = res.body.data;
    exportId = data.id;
    expect(data.exportId).toMatch(/^exp_/);
    expect(data.recordCount).toBe(1);
    expect(data.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(data.manifest.counts.records).toBe(1);
    expect(data.manifest.integrity.audit_passed).toBe(true);
    expect(data.warnings).toEqual(expect.any(Array));

    const history = await request(app.getHttpServer())
      .get('/api/v1/dataset-items/exports')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(history.status).toBe(200);
    expect(history.body.total).toBeGreaterThanOrEqual(1);

    const download = await request(app.getHttpServer())
      .get(`/api/v1/dataset-items/exports/${exportId}/download`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('zip');
  });

  it('ekspor raw dengan gambar ikut menyertakan berkas gambar', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items/exports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ profile: 'raw', format: 'json', status: 'approved', includeImages: true });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.imageCount).toBe(1);
    expect(res.body.data.manifest.integrity.missing_images).toBe(0);
  });

  it('ekspor tanpa record → 422 EMPTY_EXPORT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items/exports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ profile: 'nlp', status: 'rejected' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('EMPTY_EXPORT');
  });

  it('rasio split tidak valid ditolak 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items/exports/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ profile: 'nlp', trainRatio: 0.9, validationRatio: 0.5, testRatio: 0.5 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_SPLIT_RATIOS');
  });

  it('hapus record membersihkan baris', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/dataset-items/${duplicateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const after = await request(app.getHttpServer())
      .get(`/api/v1/dataset-items/${duplicateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.status).toBe(404);
  });

  it('pengguna mengontribusikan deteksi miliknya → draft untuk ditinjau admin', async () => {
    const detection: any = await detectionRepo.create({
      userId: normalUserId,
      result: 'unsafe',
      confidenceScore: 0.8,
      detectionMethod: 'text_input',
      modelName: 'bilstm',
      ocrText: 'komposisi: tepung terigu, susu bubuk',
    } as any);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/detections/${detection.id}/contribute`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        corrected_text: 'komposisi: tepung terigu, susu bubuk, gula',
        gold_label: 'unsafe',
        corrected_allergens: [{ name: 'Susu', severity: 'medium', confidence: 0.9 }],
        notes: 'Koreksi dari pengguna',
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.source).toBe('user_submission');
    expect(res.body.data.acquisitionSource).toBe('user_scan');
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.detectionId).toBe(detection.id);
    expect(res.body.data.submittedBy).toBe(normalUserId);

    const dup = await request(app.getHttpServer())
      .post(`/api/v1/detections/${detection.id}/contribute`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ALREADY_CONTRIBUTED');
  });

  it('pengguna lain tidak boleh mengontribusikan deteksi bukan miliknya', async () => {
    const foreign: any = await detectionRepo.create({
      userId: null,
      result: 'safe',
      confidenceScore: 0.9,
      detectionMethod: 'text_input',
      modelName: 'bilstm',
      ocrText: 'air mineral',
    } as any);
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/detections/${foreign.id}/contribute`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(forbidden.status).toBe(403);

    const admin = await request(app.getHttpServer())
      .post(`/api/v1/detections/${foreign.id}/contribute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Promosi admin' });
    expect([200, 201]).toContain(admin.status);
    expect(admin.body.data.source).toBe('detection');
  });


  it('create status=verified mencatat verifier dan waktu', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dataset-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        createPayload({
          product_name: 'Verified With Actor',
          status: 'verified',
          corrected_allergens: [{ name: 'Susu', severity: 'medium', confidence: 0.9, presence: 'present' }],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('verified');
    expect(res.body.data.verifiedBy).toBeGreaterThan(0);
    expect(res.body.data.verifiedAt).toBeTruthy();
    expect(res.body.data.reviewedBy).toBeGreaterThan(0);
    expect(res.body.data.reviewedAt).toBeTruthy();
  });

  it('unggah gambar: valid diterima, isi rusak & MIME spoof ditolak', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/dataset-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload({ product_name: 'Image Validation' }));
    const id = created.body.data.id;

    const corrupt = await request(app.getHttpServer())
      .post(`/api/v1/dataset-items/${id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', Buffer.from('not-an-image'), { filename: 'broken.png', contentType: 'image/png' });
    expect(corrupt.status).toBe(400);
    expect(corrupt.body.code).toBe('INVALID_IMAGE_CONTENT');

    const spoof = await request(app.getHttpServer())
      .post(`/api/v1/dataset-items/${id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', Buffer.from('<html><script>x</script></html>'), { filename: 'evil.png', contentType: 'image/png' });
    expect(spoof.status).toBe(400);
    expect(spoof.body.code).toBe('INVALID_IMAGE_CONTENT');

    const valid = await request(app.getHttpServer())
      .post(`/api/v1/dataset-items/${id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', PNG_1PX, { filename: 'ok.png', contentType: 'image/png' });
    expect(valid.status).toBe(201);
    expect(valid.body.data.imageWidth).toBe(1);
    expect(valid.body.data.imageChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('kontribusi bersamaan untuk deteksi yang sama: satu sukses, satu 409', async () => {
    const detection: any = await detectionRepo.create({
      userId: normalUserId,
      result: 'safe',
      confidenceScore: 0.9,
      detectionMethod: 'text_input',
      modelName: 'bilstm',
      ocrText: 'air mineral',
    } as any);
    const send = () =>
      request(app.getHttpServer())
        .post(`/api/v1/detections/${detection.id}/contribute`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({});
    const [a, b] = await Promise.all([send(), send()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const count = await request(app.getHttpServer())
      .get(`/api/v1/dataset-items?search=air%20mineral`)
      .set('Authorization', `Bearer ${adminToken}`);
    const rows = count.body.data.filter((r: any) => r.detectionId === detection.id);
    expect(rows).toHaveLength(1);
  });

  it('menghapus record promosi tidak menghapus gambar deteksi bersama', async () => {
    mkdirSync(join(process.cwd(), 'uploads'), { recursive: true });
    const shared = join(process.cwd(), 'uploads', 'e2e-shared-detection.png');
    writeFileSync(shared, PNG_1PX);
    const detection: any = await detectionRepo.create({
      userId: normalUserId,
      result: 'unsafe',
      confidenceScore: 0.9,
      detectionMethod: 'image_ocr',
      modelName: 'bilstm',
      ocrText: 'komposisi: susu',
      imageUrl: '/uploads/e2e-shared-detection.png',
    } as any);
    const promoted = await request(app.getHttpServer())
      .post(`/api/v1/detections/${detection.id}/contribute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(promoted.status).toBe(201);
    const del = await request(app.getHttpServer())
      .delete(`/api/v1/dataset-items/${promoted.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    expect(existsSync(shared)).toBe(true);
    unlinkSync(shared);
  });

  it('koreksi manusia atas anotasi model mengubah provenance menjadi hybrid', async () => {
    const detection: any = await detectionRepo.create({
      userId: normalUserId,
      result: 'unsafe',
      confidenceScore: 0.9,
      detectionMethod: 'text_input',
      modelName: 'bilstm',
      ocrText: 'komposisi: susu bubuk',
    } as any);
    const contributed = await request(app.getHttpServer())
      .post(`/api/v1/detections/${detection.id}/contribute`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(contributed.body.data.annotationSource).toBe('model');
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/dataset-items/${contributed.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ corrected_allergens: [{ name: 'Susu', severity: 'medium', confidence: 0.95, presence: 'present' }] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.annotationSource).toBe('hybrid');
    expect(updated.body.data.annotatorId).toBeGreaterThan(0);
  });

  it('optimistic concurrency: update dengan versi lama ditolak 409', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/dataset-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload({ product_name: 'Concurrency Test' }));
    const id = created.body.data.id;
    const first = await request(app.getHttpServer())
      .patch(`/api/v1/dataset-items/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'first edit', expected_updated_at: created.body.data.updatedAt });
    expect(first.status).toBe(200);
    const stale = await request(app.getHttpServer())
      .patch(`/api/v1/dataset-items/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'stale edit', expected_updated_at: created.body.data.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_UPDATE');
  });

});
