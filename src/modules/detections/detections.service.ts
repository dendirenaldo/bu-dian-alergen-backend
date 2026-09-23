import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { HttpService } from '@nestjs/axios';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { Op } from 'sequelize';
import { firstValueFrom } from 'rxjs';
import { Detection } from './models/detection.model';
import { DetectionAllergen } from './models/detection-allergen.model';
import { FreeDetectionLog } from './models/free-detection-log.model';
import { FreeDetectionCounter } from './models/free-detection-counter.model';
import { Allergen } from '../allergens/models/allergen.model';
import { Product } from '../products/models/product.model';
import { User } from '../users/models/user.model';
import { DEFAULT_DETECTION_MODEL, DETECTION_MODELS, DetectionModelChoice } from './dto/detect-model.query';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FormData = require('form-data');

export const FREE_DETECTION_LIMIT = 5;
export const FREE_DETECTION_WINDOW_MS = 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeModel(input?: string): DetectionModelChoice {
  const v = String(input ?? DEFAULT_DETECTION_MODEL).toLowerCase().trim();
  if ((DETECTION_MODELS as readonly string[]).includes(v)) return v as DetectionModelChoice;
  throw new BadRequestException('Model harus salah satu: bilstm, bert, ensemble');
}

export function extractClientIp(req: any): string {
  const cf = req?.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim().split(',')[0].trim();
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.trim().split(',')[0].trim();
  const ip = req?.ip || req?.socket?.remoteAddress || 'unknown';
  return String(ip).replace(/^::ffff:/, '');
}

export function hashIp(ip: string): string {
  const pepper = process.env.FREE_DETECTION_PEPPER || process.env.JWT_SECRET || 'budian-pepper';
  return createHash('sha256').update(`${pepper}:${ip}`).digest('hex');
}

export function extractAnonId(req: any): string | null {
  const h = req?.headers?.['x-anon-id'];
  if (typeof h === 'string' && UUID_RE.test(h.trim())) return h.trim().toLowerCase();
  const c = req?.cookies?.['anon_id'] ?? req?.signedCookies?.['anon_id'];
  if (typeof c === 'string' && UUID_RE.test(c.trim())) return c.trim().toLowerCase();
  return null;
}

export function ensureAnonId(req: any): string {
  return extractAnonId(req) ?? randomUUID();
}

@Injectable()
export class DetectionsService {
  private readonly logger = new Logger(DetectionsService.name);

  constructor(
    @InjectModel(Detection)
    private detectionModel: typeof Detection,
    @InjectModel(DetectionAllergen)
    private detectionAllergenModel: typeof DetectionAllergen,
    @InjectModel(FreeDetectionLog)
    private freeLogModel: typeof FreeDetectionLog,
    @InjectModel(FreeDetectionCounter)
    private counterModel: typeof FreeDetectionCounter,
    @InjectModel(Allergen)
    private allergenModel: typeof Allergen,
    @InjectModel(User)
    private userModel: typeof User,
    private httpService: HttpService,
  ) {}

  private get mlServiceUrl() {
    return process.env.ML_SERVICE_URL || 'http://localhost:8000';
  }

  private get mlApiKey() {
    return process.env.ML_API_KEY || '';
  }

  private mlHeaders(extra: Record<string, string> = {}) {
    return {
      ...extra,
      ...(this.mlApiKey ? { 'x-api-key': this.mlApiKey } : {}),
    };
  }

  private mapMlError(e: any, fallback: string): never {
    const status = e?.response?.status as number | undefined;
    const detail =
      e?.response?.data?.detail || e?.response?.data?.message || e?.message || fallback;
    if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || /timeout/i.test(String(e?.message))) {
      throw new GatewayTimeoutException(`Layanan ML timeout. ${fallback}`);
    }
    if (status === 400) throw new BadRequestException(String(detail));
    if (status === 401) throw new UnauthorizedException('Kunci API ML tidak valid');
    if (status === 413) throw new PayloadTooLargeException('Gambar terlalu besar (maks 10MB di ML)');
    if (status === 503) {
      const d = String(detail);
      if (/bert|ensemble/i.test(d)) {
        throw new ServiceUnavailableException(
          'Model bert belum tersedia di server, coba model bilstm atau coba lagi nanti',
        );
      }
      throw new ServiceUnavailableException('Model ML belum siap, coba lagi nanti');
    }
    if (status && status >= 500) throw new ServiceUnavailableException(`Layanan ML gagal: ${detail}`);
    if (status) throw new InternalServerErrorException(String(detail));
    throw new ServiceUnavailableException(`Layanan ML tidak terjangkau. ${fallback}`);
  }

  private async persistUpload(filename: string, buffer: Buffer) {
    try {
      const dir = join(process.cwd(), 'uploads');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, filename), buffer);
    } catch (e) {
      this.logger.warn(`Gagal menyimpan upload ${filename}: ${e?.message}`);
    }
  }

  private async linkAllergens(detectionId: number, allergens: any[]) {
    if (!Array.isArray(allergens) || allergens.length === 0) return;
    try {
      const rows: { detectionId: number; allergenId: number; confidenceScore: number }[] = [];
      for (const a of allergens) {
        const name = String(a?.name || '').trim();
        if (!name) continue;
        const found = await this.allergenModel.findOne({ where: { name } });
        if (found) {
          rows.push({
            detectionId,
            allergenId: found.id,
            confidenceScore: Number(a?.confidence ?? 0) || 0,
          });
        }
      }
      if (rows.length) {
        await this.detectionAllergenModel.bulkCreate(rows as any[], {
          ignoreDuplicates: true,
        } as any);
      }
    } catch (e) {
      this.logger.warn(`Gagal menyimpan relasi alergen: ${e?.message}`);
    }
  }

  private mlResultMeta(mlResult: any, fallbackModel: DetectionModelChoice, fallbackMethod: string) {
    const rawName = typeof mlResult?.model_name === 'string' ? mlResult.model_name.toLowerCase().trim() : '';
    const modelName = (DETECTION_MODELS as readonly string[]).includes(rawName) ? rawName : fallbackModel;
    const method = typeof mlResult?.detection_method === 'string' && mlResult.detection_method
      ? mlResult.detection_method
      : fallbackMethod;
    return { modelName, method };
  }

  async detectFromImage(
    userId: number,
    imageBuffer: Buffer,
    filename: string,
    mimetype = 'image/jpeg',
    modelInput?: string,
  ) {
    const model = normalizeModel(modelInput);
    const form = new FormData();
    // Nama field 'file' sesuai kontrak ML (app/api/routers/detection.py).
    form.append('file', imageBuffer, { filename, contentType: mimetype });

    let mlResult: any;
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.mlServiceUrl}/api/v1/detection/upload?model=${model}`,
          form,
          {
            headers: this.mlHeaders(form.getHeaders()),
            timeout: 120000,
          },
        ),
      );
      mlResult = response.data;
    } catch (e) {
      this.mapMlError(e, 'Deteksi gambar gagal diproses.');
    }

    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      throw new InternalServerErrorException('Respons ML tidak valid');
    }

    await this.persistUpload(filename, imageBuffer);

    const { modelName, method } = this.mlResultMeta(mlResult, model, 'image_ocr');

    const detection = await this.detectionModel.create({
      userId,
      imageUrl: `/uploads/${filename}`,
      ocrText: mlResult.ocr_text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score ?? 0,
      processingTimeMs: mlResult.processing_time_ms ?? null,
      detectionMethod: 'image_ocr',
      modelName,
      isGuest: false,
    } as any);
    void method;

    await this.linkAllergens(detection.id, mlResult.allergens);

    return detection;
  }

  async detectFromText(userId: number, text: string, modelInput?: string) {
    const model = normalizeModel(modelInput);
    let mlResult: any;
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.mlServiceUrl}/api/v1/detection/text?model=${model}`,
          { text },
          {
            headers: this.mlHeaders({ 'Content-Type': 'application/json' }),
            timeout: 120000,
          },
        ),
      );
      mlResult = response.data;
    } catch (e) {
      this.mapMlError(e, 'Klasifikasi teks gagal diproses.');
    }

    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      throw new InternalServerErrorException('Respons ML tidak valid');
    }

    const { modelName } = this.mlResultMeta(mlResult, model, 'text_input');

    const detection = await this.detectionModel.create({
      userId,
      ocrText: text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score ?? 0,
      processingTimeMs: mlResult.processing_time_ms ?? null,
      detectionMethod: 'text_input',
      modelName,
      isGuest: false,
    } as any);

    await this.linkAllergens(detection.id, mlResult.allergens);

    return detection;
  }

  // ---------- Free detection tanpa login: hanya bisa 5x per jam ----------
  //
  // Anti-race (MySQL saja, tanpa Redis): enforcement memakai tabel
  // free_detection_counters dengan jendela jam kalender UTC. Setiap request
  // menambah counter via SATU statement atomik (INSERT ... ON DUPLICATE KEY
  // UPDATE) per identitas ('ip:<hash>' dan 'anon:<uuid>'). Karena increment
  // itu atomik di level baris, N request konkuren tidak bisa sama-sama lolos:
  // yang melebihi batas langsung decrement kembali + 429.
  // free_detection_logs dipertahankan sebagai audit (deteksi yang selesai).

  /** Bucket jam kalender UTC 'YYYYMMDDHH'. */
  private hourBucket(now = new Date()) {
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}`;
  }

  /** Detik sampai awal jam UTC berikutnya (untuk Retry-After). */
  private secondsToNextHour(now = new Date()) {
    const next = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() + 1,
    );
    return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
  }

  private counterIdentities(ipHash: string, anonId: string | null) {
    const ids = [`ip:${ipHash}`];
    if (anonId) ids.push(`anon:${anonId}`);
    return ids;
  }

  private async atomicInc(identity: string, window: string) {
    await (this.counterModel.sequelize as any).query(
      'INSERT INTO `free_detection_counters` (`identity`, `window_key`, `count`, `updated_at`) ' +
        'VALUES (?, ?, 1, NOW()) ON DUPLICATE KEY UPDATE `count` = `count` + 1, `updated_at` = NOW()',
      { replacements: [identity, window] },
    );
  }

  private async atomicDec(identity: string, window: string) {
    await (this.counterModel.sequelize as any).query(
      'UPDATE `free_detection_counters` SET `count` = GREATEST(`count` - 1, 0), `updated_at` = NOW() ' +
        'WHERE `identity` = ? AND `window_key` = ?',
      { replacements: [identity, window] },
    );
  }

  private async readCounts(identities: string[], window: string) {
    const rows = await this.counterModel.findAll({ where: { identity: identities, windowKey: window } });
    const map = new Map<string, number>();
    for (const r of rows) map.set((r as any).identity, Number((r as any).count) || 0);
    return identities.map((id) => map.get(id) ?? 0);
  }

  private windowStart() {
    return new Date(Date.now() - FREE_DETECTION_WINDOW_MS);
  }

  /** Read-only: untuk GET /public/quota dan fast-path sebelum reservasi. */
  async checkPublicQuota(ipHash: string, anonId: string | null) {
    const window = this.hourBucket();
    const counts = await this.readCounts(this.counterIdentities(ipHash, anonId), window);
    const used = Math.max(0, ...counts);
    const remaining = Math.max(0, FREE_DETECTION_LIMIT - used);
    return {
      used,
      remaining,
      allowed: remaining > 0,
      retryAfterSec: remaining > 0 ? 0 : this.secondsToNextHour(),
    };
  }

  /**
   * Reservasi atomik: increment kedua counter, tolak bila salah satu melebihi
   * batas (lalu kembalikan keduanya). Mengembalikan sisa kuota.
   */
  private async reservePublicQuota(ipHash: string, anonId: string) {
    const window = this.hourBucket();
    const identities = this.counterIdentities(ipHash, anonId);
    // Bersih-bersih oportunistik (best-effort, jangan gagalkan request).
    void this.counterModel
      .destroy({ where: { updatedAt: { [Op.lt]: new Date(Date.now() - 48 * 3600 * 1000) } } })
      .catch((e) => this.logger.warn(`Gagal membersihkan counter kuota: ${e?.message}`));
    for (const id of identities) await this.atomicInc(id, window);
    const counts = await this.readCounts(identities, window);
    const used = Math.max(...counts);
    if (used > FREE_DETECTION_LIMIT) {
      for (const id of identities) await this.atomicDec(id, window);
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Batas tercapai: deteksi hanya bisa 5x per jam. Coba lagi nanti atau masuk untuk lanjut.',
          retryAfterSec: this.secondsToNextHour(),
          remaining: 0,
          limit: FREE_DETECTION_LIMIT,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { remaining: Math.max(0, FREE_DETECTION_LIMIT - used) };
  }

  private assertQuota(q: { allowed: boolean; retryAfterSec: number; remaining: number }) {
    if (q.allowed) return;
    throw new HttpException(
      {
        statusCode: 429,
        message: 'Batas tercapai: deteksi hanya bisa 5x per jam. Coba lagi nanti atau masuk untuk lanjut.',
        retryAfterSec: q.retryAfterSec,
        remaining: 0,
        limit: FREE_DETECTION_LIMIT,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Escape karakter wildcard LIKE agar ?search=% tidak match semua. */
  private escapeLike(s: string) {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
  }

  private async callMlText(text: string, model: DetectionModelChoice) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.mlServiceUrl}/api/v1/detection/text?model=${model}`,
          { text },
          { headers: this.mlHeaders({ 'Content-Type': 'application/json' }), timeout: 120000 },
        ),
      );
      return response.data;
    } catch (e) {
      this.mapMlError(e, 'Klasifikasi teks gagal diproses.');
    }
  }

  private async callMlImage(buffer: Buffer, filename: string, mimetype: string, model: DetectionModelChoice) {
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimetype });
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.mlServiceUrl}/api/v1/detection/upload?model=${model}`, form, {
          headers: this.mlHeaders(form.getHeaders()),
          timeout: 120000,
        }),
      );
      return response.data;
    } catch (e) {
      this.mapMlError(e, 'Deteksi gambar gagal diproses.');
    }
  }

  async detectPublicFromText(opts: {
    text: string;
    modelInput?: string;
    ipHash: string;
    anonId: string;
  }) {
    const model = normalizeModel(opts.modelInput);
    // Fast-path read-only agar tidak mengotori counter saat kuota jelas habis.
    this.assertQuota(await this.checkPublicQuota(opts.ipHash, opts.anonId));
    // Reservasi atomik SEBELUM panggil ML: kegagalan ML ikut memakan kuota
    // (mencegah spam biaya ML) dan request konkuren tidak bisa sama-sama lolos.
    const { remaining } = await this.reservePublicQuota(opts.ipHash, opts.anonId);
    const mlResult = await this.callMlText(opts.text, model);
    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      throw new InternalServerErrorException('Respons ML tidak valid');
    }
    const { modelName } = this.mlResultMeta(mlResult, model, 'text_input');
    const detection = await this.detectionModel.create({
      userId: null,
      anonId: opts.anonId,
      ipHash: opts.ipHash,
      isGuest: true,
      ocrText: opts.text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score ?? 0,
      processingTimeMs: mlResult.processing_time_ms ?? null,
      detectionMethod: 'text_input',
      modelName,
    } as any);
    await this.linkAllergens((detection as any).id, mlResult.allergens);
    return { detection, remaining };
  }

  async detectPublicFromImage(opts: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
    modelInput?: string;
    ipHash: string;
    anonId: string;
  }) {
    const model = normalizeModel(opts.modelInput);
    this.assertQuota(await this.checkPublicQuota(opts.ipHash, opts.anonId));
    // Reservasi atomik SEBELUM panggil ML (lihat detectPublicFromText).
    const remaining = (await this.reservePublicQuota(opts.ipHash, opts.anonId)).remaining;
    const mlResult = await this.callMlImage(opts.buffer, opts.filename, opts.mimetype, model);
    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      throw new InternalServerErrorException('Respons ML tidak valid');
    }
    await this.persistUpload(opts.filename, opts.buffer);
    const { modelName } = this.mlResultMeta(mlResult, model, 'image_ocr');
    const detection = await this.detectionModel.create({
      userId: null,
      anonId: opts.anonId,
      ipHash: opts.ipHash,
      isGuest: true,
      imageUrl: `/uploads/${opts.filename}`,
      ocrText: mlResult.ocr_text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score ?? 0,
      processingTimeMs: mlResult.processing_time_ms ?? null,
      detectionMethod: 'image_ocr',
      modelName,
    } as any);
    await this.linkAllergens((detection as any).id, mlResult.allergens);
    return { detection, remaining };
  }

  async findAllByUser(userId: number, page = 1, limit = 10) {
    const safePage = Number.isFinite(+page) && +page > 0 ? Math.floor(+page) : 1;
    const safeLimit =
      Number.isFinite(+limit) && +limit > 0 ? Math.min(Math.floor(+limit), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const { rows, count } = await this.detectionModel.findAndCountAll({
      where: { userId },
      include: [
        { model: Product, as: 'product' },
        {
          model: DetectionAllergen,
          as: 'detectionAllergens',
          include: [{ model: Allergen, as: 'allergen' }],
        },
      ],
      offset,
      limit: safeLimit,
      order: [['createdAt', 'DESC']],
    });
    return {
      data: rows,
      total: count,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    };
  }

  /** Admin: semua riwayat + identitas pemilik (pengguna / tamu). */
  async findAllAdmin(query: { page?: number; limit?: number; userId?: number; result?: string; search?: string }) {
    const safePage = Number.isFinite(+query.page) && +query.page > 0 ? Math.floor(+query.page) : 1;
    const safeLimit =
      Number.isFinite(+query.limit) && +query.limit > 0 ? Math.min(Math.floor(+query.limit), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const where: any = {};
    if (query.userId) where.userId = query.userId;
    if (query.result === 'safe' || query.result === 'unsafe') where.result = query.result;
    if (query.search && String(query.search).trim()) {
      const raw = String(query.search).trim().slice(0, 100);
      const esc = this.escapeLike(raw);
      const like = { [Op.like]: `%${esc}%` };
      const ors: any[] = [{ ocrText: like }, { imageUrl: like }];
      // Cari juga berdasarkan nama/email pemilik.
      const matchedUsers = await this.userModel.findAll({
        where: { [Op.or]: [{ name: like }, { email: like }] },
        attributes: ['id'],
        limit: 50,
      });
      const ids = matchedUsers.map((u: any) => u.id);
      if (ids.length) ors.push({ userId: { [Op.in]: ids } });
      if (/tamu|guest/i.test(raw)) ors.push({ isGuest: true });
      where[Op.or] = ors;
    }
    const { rows, count } = await this.detectionModel.findAndCountAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'role'] },
        { model: Product, as: 'product' },
        {
          model: DetectionAllergen,
          as: 'detectionAllergens',
          include: [{ model: Allergen, as: 'allergen' }],
        },
      ],
      offset,
      limit: safeLimit,
      order: [['createdAt', 'DESC']],
    });
    return {
      data: rows,
      total: count,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    };
  }

  private assertOwnership(detection: Detection, userId?: number, role?: string) {
    if (role === 'admin') return;
    if (!userId || (detection as any).userId !== Number(userId)) {
      throw new ForbiddenException('Anda tidak berhak mengakses data ini');
    }
  }

  async findById(id: number, userId?: number, role?: string) {
    const detection = await this.detectionModel.findByPk(id, {
      include: [
        { model: User, as: 'user', attributes: { exclude: ['password'] } },
        { model: Product, as: 'product' },
        {
          model: DetectionAllergen,
          as: 'detectionAllergens',
          include: [{ model: Allergen, as: 'allergen' }],
        },
      ],
    });
    if (!detection) throw new NotFoundException('Detection not found');
    this.assertOwnership(detection, userId, role);
    return detection;
  }

  async remove(id: number, userId?: number, role?: string) {
    const detection = await this.findById(id, userId, role);
    await detection.destroy();
    return { message: 'Detection deleted' };
  }
}
