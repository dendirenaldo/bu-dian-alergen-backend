/**
 * End-to-end: register → login → deteksi teks/gambar → riwayat → RBAC/IDOR.
 * ML service di-mock via HttpService (tanpa TensorFlow/Tesseract).
 * DB: SQLite in-memory (tanpa MySQL).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SequelizeModule, getModelToken } from '@nestjs/sequelize';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import request = require('supertest');

import { AuthModule } from '../src/modules/auth/auth.module';
import { UsersModule } from '../src/modules/users/users.module';
import { CategoriesModule } from '../src/modules/categories/categories.module';
import { ProductsModule } from '../src/modules/products/products.module';
import { IngredientsModule } from '../src/modules/ingredients/ingredients.module';
import { AllergensModule } from '../src/modules/allergens/allergens.module';
import { DetectionsModule } from '../src/modules/detections/detections.module';
import { ContentsModule } from '../src/modules/contents/contents.module';
import { DashboardModule } from '../src/modules/dashboard/dashboard.module';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { User } from '../src/modules/users/models/user.model';
import { AllExceptionsFilter } from '../src/common/filters/validation-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
// Env diset di test/setup-e2e.ts (setupFiles) sebelum modul diimpor.

const ML_TEXT_RESULT = {
  result: 'unsafe',
  confidence_score: 0.92,
  ocr_text: 'tepung terigu, susu bubuk, garam',
  allergens: [{ name: 'Gluten', confidence: 1.0, severity: 'high' }],
  processing_time_ms: 123,
  detection_method: 'text_input',
};

describe('E2E: register → login → deteksi → riwayat', () => {
  let app: INestApplication;
  let userRepo: typeof User;

  const mockHttp = {
    post: jest.fn((url: string) => {
      if (String(url).includes('/detection/upload')) {
        return of({
          data: {
            ...ML_TEXT_RESULT,
            ocr_text: 'wheat flour, milk',
            detection_method: 'image_ocr',
          },
        });
      }
      return of({ data: ML_TEXT_RESULT });
    }),
  };

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
        ContentsModule,
        DashboardModule,
        SettingsModule,
      ],
    })
      .overrideProvider(HttpService)
      .useValue(mockHttp)
      // ConfigService ESM interop pecah di ts-jest → mock minimal.
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string, fallback?: unknown) => process.env[key] ?? fallback,
      })
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
  });

  afterAll(async () => {
    await app.close();
  });

  const userA = { name: 'User A', email: 'a@e2e.id', password: 'Password123' };
  const userB = { name: 'User B', email: 'b@e2e.id', password: 'Password123' };
  const userC = { name: 'User C', email: 'c@e2e.id', password: 'Password123' };
  let tokenB = '';
  let tokenC = '';
  let detectionId = 0;

  it('register user A/B/C → 201 + duplicate → 409', async () => {
    for (const u of [userA, userB, userC]) {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send(u);
      expect(res.status).toBe(201);
      expect(res.body.data.token).toBeDefined();
    }
    const dup = await request(app.getHttpServer()).post('/api/v1/auth/register').send(userA);
    expect(dup.status).toBe(409);
  });

  it('login: password salah → 401, benar → 200 (bukti double-hash sembuh)', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userB.email, password: 'Salah1234' });
    expect(wrong.status).toBe(401);

    const ok = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userB.email, password: userB.password });
    expect([200, 201]).toContain(ok.status);
    tokenB = ok.body.data.token;
    expect(tokenB).toBeTruthy();

    const okC = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userC.email, password: userC.password });
    tokenC = okC.body.data.token;
  });

  it('RBAC: user biasa dilarang akses /dashboard/stats → 403, tanpa token → 401', async () => {
    const forbidden = await request(app.getHttpServer())
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(forbidden.status).toBe(403);

    const unauth = await request(app.getHttpServer()).get('/api/v1/detections');
    expect(unauth.status).toBe(401);
  });

  it('deteksi teks → 201 + masuk riwayat', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/detections/text')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ text: 'komposisi: tepung terigu, susu bubuk' });
    expect(res.status).toBe(201);
    expect(res.body.data.result).toBe('unsafe');
    detectionId = res.body.data.id;
    expect(detectionId).toBeGreaterThan(0);
    expect(mockHttp.post).toHaveBeenCalled();

    const list = await request(app.getHttpServer())
      .get('/api/v1/detections?page=1&limit=10')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect(list.body.meta.total).toBe(list.body.total);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/detections/${detectionId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(detail.status).toBe(200);
  });

  it('IDOR: user lain 403 baca/hapus, pemilik bisa hapus', async () => {
    const readOther = await request(app.getHttpServer())
      .get(`/api/v1/detections/${detectionId}`)
      .set('Authorization', `Bearer ${tokenC}`);
    expect(readOther.status).toBe(403);

    const delOther = await request(app.getHttpServer())
      .delete(`/api/v1/detections/${detectionId}`)
      .set('Authorization', `Bearer ${tokenC}`);
    expect(delOther.status).toBe(403);

    const delOwner = await request(app.getHttpServer())
      .delete(`/api/v1/detections/${detectionId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(delOwner.status).toBe(200);

    const gone = await request(app.getHttpServer())
      .get(`/api/v1/detections/${detectionId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(gone.status).toBe(404);
  });

  it('validasi: teks kosong → 400, upload tanpa file → 400', async () => {
    const empty = await request(app.getHttpServer())
      .post('/api/v1/detections/text')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ text: '   ' });
    expect(empty.status).toBe(400);

    const noFile = await request(app.getHttpServer())
      .post('/api/v1/detections/upload')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(noFile.status).toBe(400);
  });

  it('upload gambar → 201 + imageUrl /uploads/', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await request(app.getHttpServer())
      .post('/api/v1/detections/upload')
      .set('Authorization', `Bearer ${tokenB}`)
      .attach('image', png, 'label.png');
    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toMatch(/^\/uploads\//);
    expect(res.body.data.detectionMethod).toBe('image_ocr');
  });

  it('admin: stats + trend 14 hari + limit invalid graceful (tanpa 500)', async () => {
    await userRepo.update({ role: 'admin' } as any, { where: { email: userA.email } });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userA.email, password: userA.password });
    const adminToken = login.body.data.token;

    const stats = await request(app.getHttpServer())
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(stats.status).toBe(200);
    expect(stats.body.data.totalDetections).toBeGreaterThanOrEqual(1);

    const trend = await request(app.getHttpServer())
      .get('/api/v1/dashboard/trend?days=14')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(trend.status).toBe(200);
    expect(trend.body.data.trend).toHaveLength(14);

    const bad = await request(app.getHttpServer())
      .get('/api/v1/dashboard/recent?limit=abc')
      .set('Authorization', `Bearer ${adminToken}`);
    // Graceful: 'abc' → NaN → DefaultValuePipe → 10 (tanpa 500/NaN crash).
    expect(bad.status).toBe(200);

    const huge = await request(app.getHttpServer())
      .get('/api/v1/dashboard/recent?limit=999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(huge.status).toBe(200);
  });
});
