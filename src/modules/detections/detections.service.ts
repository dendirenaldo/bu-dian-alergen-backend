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

/** TTL map idempotency uploadId/Idempotency-Key -> detectionId (24 jam). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Kontrak event SSE Fase 1 (progress wajib persis untuk 9 tahap sukses). */
export interface SseContractEvent {
  stage: string;
  progress: number;
  message: string;
  etaMs?: number;
  data?: any;
}

export const SSE_PROGRESS: Record<string, number> = {
  received: 5,
  quota_reserved: 15,
  upload_ok: 25,
  ml_start: 30,
  ml_ocr: 55,
  ml_infer: 80,
  ml_mapping: 90,
  db_saved: 95,
  done: 100,
};

export function buildSseEvent(
  stage: string,
  progress: number,
  message: string,
  data?: any,
  etaMs?: number,
): SseContractEvent {
  const ev: SseContractEvent = { stage, progress, message };
  if (typeof etaMs === 'number') ev.etaMs = etaMs;
  if (typeof data !== 'undefined') ev.data = data;
  return ev;
}

export function encodeSse(event: SseContractEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const SSE_HEARTBEAT = ':ping\n\n';
export const SSE_HEARTBEAT_MS = 15000;

/** Kualitas OCR sederhana dari ukuran buffer + teks/lines OCR. */
export interface OcrQuality {
  blur: number;
  coverage: number;
  lowQuality: boolean;
}

export function countOcrLines(ocrText?: string | null): number {
  const t = String(ocrText ?? '');
  if (!t.trim()) return 0;
  return t
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function computeOcrQuality(
  bufferBytes: number,
  ocrText?: string | null,
  lines?: number,
): OcrQuality {
  const size = Math.max(0, Number(bufferBytes) || 0);
  const blur = size < 30_000 ? 0.85 : size < 100_000 ? 0.5 : size < 500_000 ? 0.25 : 0.1;
  const len = String(ocrText ?? '').length;
  const coverage = Math.round(Math.min(1, len / 600) * 100) / 100;
  const lineCount = Math.max(0, Number(lines) || 0);
  const lowQuality = blur >= 0.6 || coverage < 0.15 || lineCount === 0;
  return { blur, coverage, lowQuality };
}

export type DetectionJobStatus =
  | 'received'
  | 'quota_reserved'
  | 'upload_ok'
  | 'ml_start'
  | 'ml_ocr'
  | 'ml_infer'
  | 'ml_mapping'
  | 'db_saved'
  | 'done'
  | 'error'
  | 'cancelled';

export interface DetectionJobSnapshot {
  remaining?: number | null;
  model?: string;
  lines?: number;
  backend?: string;
  count?: number;
  detectionId?: number;
  result?: any;
  ocrQuality?: OcrQuality;
  fallbackNotice?: string;
}

export interface DetectionJob {
  uploadId: string;
  status: DetectionJobStatus;
  kind: 'image' | 'text';
  userId: number | null;
  ipHash: string | null;
  anonId: string | null;
  quotaWindow: string | null;
  remaining: number | null;
  idempotencyKey: string | null;
  detectionId?: number;
  snapshot?: DetectionJobSnapshot;
  fallbackNotice?: string;
  error?: string;
  cancelled: boolean;
  refunded: boolean;
  createdAt: number;
  updatedAt: number;
}

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
  const pepper = process.env.FREE_DETECTION_PEPPER || process.env.JWT_SECRET || 'allergendetector-pepper';
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

  /** Job map in-memory: uploadId -> status/detectionId (siklus SSE + cancel). */
  private readonly jobs = new Map<string, DetectionJob>();
  /** Idempotency map: uploadId / Idempotency-Key -> detectionId (24 jam). */
  private readonly idempotency = new Map<
    string,
    { detectionId: number; remaining: number | null; expiresAt: number }
  >();

  newJobId(): string {
    return randomUUID();
  }

  createJob(uploadId: string, init: Partial<DetectionJob> = {}): DetectionJob {
    const now = Date.now();
    const job: DetectionJob = {
      status: 'received',
      kind: 'image',
      userId: null,
      ipHash: null,
      anonId: null,
      quotaWindow: null,
      remaining: null,
      idempotencyKey: null,
      cancelled: false,
      refunded: false,
      createdAt: now,
      updatedAt: now,
      ...init,
      uploadId,
    };
    this.jobs.set(uploadId, job);
    return job;
  }

  getJob(uploadId: string): DetectionJob | undefined {
    return this.jobs.get(uploadId);
  }

  updateJob(uploadId: string, patch: Partial<DetectionJob>): void {
    const job = this.jobs.get(uploadId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: Date.now() });
  }

  private pruneIdempotency(): void {
    const now = Date.now();
    for (const [k, v] of this.idempotency) {
      if (v.expiresAt <= now) this.idempotency.delete(k);
    }
  }

  lookupIdempotency(key?: string | null): { detectionId: number; remaining: number | null } | undefined {
    if (!key) return undefined;
    this.pruneIdempotency();
    const hit = this.idempotency.get(String(key));
    return hit ? { detectionId: hit.detectionId, remaining: hit.remaining } : undefined;
  }

  saveIdempotency(key?: string | null, detectionId?: number, remaining?: number | null): void {
    if (!key || !detectionId) return;
    this.pruneIdempotency();
    this.idempotency.set(String(key), {
      detectionId,
      remaining: remaining ?? null,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  /** Kembalikan kuota publik yang sudah direservasi (aman dipanggil ganda). */
  async refundPublicQuota(ipHash?: string | null, anonId?: string | null, window?: string | null): Promise<void> {
    if (!ipHash) return;
    const w = window || this.hourBucket();
    try {
      const identities = this.counterIdentities(ipHash, anonId ?? null);
      for (const id of identities) await this.atomicDec(id, w);
    } catch (e) {
      this.logger.warn(`Gagal refund kuota: ${(e as any)?.message}`);
    }
  }

  /** Refund kuota via job map (dipakai saat client abort / cancel / ML 5xx). */
  async refundJobQuota(uploadId: string): Promise<boolean> {
    const job = this.jobs.get(uploadId);
    if (!job || job.refunded) return false;
    if (!job.ipHash || !job.quotaWindow) return false;
    await this.refundPublicQuota(job.ipHash, job.anonId, job.quotaWindow);
    job.refunded = true;
    job.updatedAt = Date.now();
    return true;
  }

  /** Batalkan job SSE + refund kuota bila ada. */
  async cancelJob(uploadId: string): Promise<{ cancelled: boolean; refunded: boolean; message: string }> {
    const job = this.jobs.get(uploadId);
    if (!job) throw new NotFoundException('Job tidak ditemukan atau sudah kedaluwarsa');
    if (job.status === 'done') {
      return { cancelled: false, refunded: false, message: 'Job sudah selesai' };
    }
    job.cancelled = true;
    job.status = 'cancelled';
    job.updatedAt = Date.now();
    const refunded = await this.refundJobQuota(uploadId);
    return { cancelled: true, refunded, message: 'Job dibatalkan' };
  }

  private assertJobAlive(uploadId?: string | null): void {
    if (!uploadId) return;
    const job = this.jobs.get(uploadId);
    if (job?.cancelled) throw new BadRequestException('Job dibatalkan');
  }

  /** Ambil baris deteksi mentah (tanpa cek kepemilikan, untuk replay SSE). */
  async getDetectionRaw(id: number) {
    return this.detectionModel.findByPk(id);
  }

  /**
   * Susun ulang 9 event kontrak dari snapshot job (dipakai GET /detections/stream).
   * Progress: received 5 → quota_reserved 15 → upload_ok 25 → ml_start 30 →
   * ml_ocr 55 → ml_infer 80 → ml_mapping 90 → db_saved 95 → done 100.
   */
  async buildJobReplay(uploadId: string): Promise<SseContractEvent[]> {
    const job = this.jobs.get(uploadId);
    if (!job) {
      return [buildSseEvent('error', 0, 'Job tidak ditemukan atau sudah kedaluwarsa', { uploadId })];
    }
    if (job.cancelled || job.status === 'cancelled') {
      return [buildSseEvent('error', 0, 'Job dibatalkan', { uploadId })];
    }
    if (job.status === 'error') {
      return [buildSseEvent('error', 100, job.error || 'Deteksi gagal', { uploadId })];
    }
    const snap: DetectionJobSnapshot = job.snapshot ?? {};
    let result: any = snap.result ?? null;
    const detId = job.detectionId ?? snap.detectionId;
    if (detId && !result) {
      const row = await this.getDetectionRaw(detId);
      if (row) result = row;
    }
    const remaining = snap.remaining ?? job.remaining ?? null;
    const model = snap.model ?? 'bert';
    const lines = snap.lines ?? 0;
    const backend = snap.backend ?? model;
    const count = snap.count ?? 0;
    const id = (result as any)?.id ?? detId ?? null;
    const isGuest = job.userId == null;
    const quality = snap.ocrQuality;
    const fallbackData = job.fallbackNotice || snap.fallbackNotice
      ? { fallbackNotice: job.fallbackNotice ?? snap.fallbackNotice }
      : undefined;
    return [
      buildSseEvent('received', SSE_PROGRESS.received, 'Permintaan diterima', { uploadId }, 15000),
      buildSseEvent(
        'quota_reserved',
        SSE_PROGRESS.quota_reserved,
        isGuest ? `Kuota dicadangkan, sisa ${remaining ?? 0}` : 'Kuota tidak berlaku untuk pengguna masuk',
        { remaining },
        12000,
      ),
      buildSseEvent(
        'upload_ok',
        SSE_PROGRESS.upload_ok,
        job.kind === 'text' ? 'Teks diterima, antrean ML disiapkan' : 'Gambar diterima, antrean ML disiapkan',
        { kind: job.kind },
        10000,
      ),
      buildSseEvent(
        'ml_start',
        SSE_PROGRESS.ml_start,
        `Inferensi ML dimulai (model ${model})`,
        { model, ...fallbackData },
        8000,
      ),
      buildSseEvent(
        'ml_ocr',
        SSE_PROGRESS.ml_ocr,
        job.kind === 'text'
          ? `Teks siap diklasifikasi (${lines} baris)`
          : `OCR selesai (${lines} baris)`,
        { lines, ...(quality ? { ocrQuality: quality } : {}) },
        5000,
      ),
      buildSseEvent(
        'ml_infer',
        SSE_PROGRESS.ml_infer,
        `Klasifikasi selesai (${backend})`,
        { backend },
        3000,
      ),
      buildSseEvent(
        'ml_mapping',
        SSE_PROGRESS.ml_mapping,
        `Pemetaan alergen selesai (${count} alergen)`,
        { count },
        1500,
      ),
      buildSseEvent('db_saved', SSE_PROGRESS.db_saved, 'Hasil deteksi disimpan', { id }, 500),
      buildSseEvent('done', SSE_PROGRESS.done, 'Deteksi selesai', { result: result ?? { id } }),
    ];
  }

  private isBertUnavailableError(e: any): boolean {
    if (e?.response?.status !== 503) return false;
    const detail = String(
      e?.response?.data?.detail ?? e?.response?.data?.message ?? e?.message ?? '',
    );
    return /bert|ensemble/i.test(detail);
  }

  /** Refund kuota bila penyebabnya ML 500/502/503/504 atau timeout (bukan 4xx validasi). */
  private isRefundableMlError(e: any): boolean {
    const status =
      typeof e?.response?.status === 'number'
        ? e.response.status
        : e instanceof HttpException
          ? e.getStatus()
          : undefined;
    if (typeof status === 'number' && [500, 502, 503, 504].includes(status)) return true;
    const code = String(e?.code ?? '');
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
    if (/timeout/i.test(String(e?.message ?? ''))) return true;
    return false;
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
    opts: { idempotencyKey?: string | null; uploadId?: string | null } = {},
  ) {
    const model = normalizeModel(modelInput);
    const cached = this.lookupIdempotency(opts.idempotencyKey || opts.uploadId);
    if (cached) {
      const hit = await this.detectionModel.findByPk(cached.detectionId);
      if (hit) {
        if (opts.uploadId) {
          if (!this.getJob(opts.uploadId)) this.createJob(opts.uploadId, { kind: 'image', userId });
          this.updateJob(opts.uploadId, {
            status: 'done',
            detectionId: hit.id,
            snapshot: this.snapshotFromDetection(hit, null, model),
          });
        }
        return hit;
      }
    }

    const { mlResult, fallbackNotice } = await this.callMlImageResilient(
      imageBuffer,
      filename,
      mimetype,
      model,
    );

    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      throw new InternalServerErrorException('Respons ML tidak valid');
    }

    this.assertJobAlive(opts.uploadId);

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
      detectionMethod: method,
      modelName,
      isGuest: false,
    } as any);

    await this.linkAllergens(detection.id, mlResult.allergens);

    if (opts.uploadId) {
      const lines = countOcrLines(mlResult.ocr_text);
      if (!this.getJob(opts.uploadId)) this.createJob(opts.uploadId, { kind: 'image', userId });
      this.updateJob(opts.uploadId, {
        status: 'done',
        detectionId: detection.id,
        fallbackNotice,
        snapshot: {
          model,
          lines,
          backend: modelName,
          count: Array.isArray(mlResult.allergens) ? mlResult.allergens.length : 0,
          detectionId: detection.id,
          ocrQuality: computeOcrQuality(imageBuffer.length, mlResult.ocr_text, lines),
          fallbackNotice,
        },
      });
    }
    this.saveIdempotency(opts.idempotencyKey, detection.id, null);
    if (opts.uploadId && opts.uploadId !== opts.idempotencyKey) {
      this.saveIdempotency(opts.uploadId, detection.id, null);
    }
    if (fallbackNotice) this.logger.warn(`Fallback ML: ${fallbackNotice}`);

    return detection;
  }

  async detectFromText(
    userId: number,
    text: string,
    modelInput?: string,
    opts: { idempotencyKey?: string | null; uploadId?: string | null } = {},
  ) {
    const model = normalizeModel(modelInput);
    const cached = this.lookupIdempotency(opts.idempotencyKey || opts.uploadId);
    if (cached) {
      const hit = await this.detectionModel.findByPk(cached.detectionId);
      if (hit) {
        if (opts.uploadId) {
          if (!this.getJob(opts.uploadId)) this.createJob(opts.uploadId, { kind: 'text', userId });
          this.updateJob(opts.uploadId, {
            status: 'done',
            detectionId: hit.id,
            snapshot: this.snapshotFromDetection(hit, null, model),
          });
        }
        return hit;
      }
    }

    const { mlResult, fallbackNotice } = await this.callMlTextResilient(text, model);

    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      throw new InternalServerErrorException('Respons ML tidak valid');
    }

    this.assertJobAlive(opts.uploadId);

    const { modelName, method } = this.mlResultMeta(mlResult, model, 'text_input');

    const detection = await this.detectionModel.create({
      userId,
      ocrText: text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score ?? 0,
      processingTimeMs: mlResult.processing_time_ms ?? null,
      detectionMethod: method,
      modelName,
      isGuest: false,
    } as any);

    await this.linkAllergens(detection.id, mlResult.allergens);

    if (opts.uploadId) {
      const lines = countOcrLines(text);
      if (!this.getJob(opts.uploadId)) this.createJob(opts.uploadId, { kind: 'text', userId });
      this.updateJob(opts.uploadId, {
        status: 'done',
        detectionId: detection.id,
        fallbackNotice,
        snapshot: {
          model,
          lines,
          backend: modelName,
          count: Array.isArray(mlResult.allergens) ? mlResult.allergens.length : 0,
          detectionId: detection.id,
          ocrQuality: computeOcrQuality(Buffer.byteLength(text || '', 'utf8'), text, lines),
          fallbackNotice,
        },
      });
    }
    this.saveIdempotency(opts.idempotencyKey, detection.id, null);
    if (opts.uploadId && opts.uploadId !== opts.idempotencyKey) {
      this.saveIdempotency(opts.uploadId, detection.id, null);
    }
    if (fallbackNotice) this.logger.warn(`Fallback ML: ${fallbackNotice}`);

    return detection;
  }


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
    return { remaining: Math.max(0, FREE_DETECTION_LIMIT - used), window };
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

  private async callMlTextResilient(
    text: string,
    model: DetectionModelChoice,
  ): Promise<{ mlResult: any; fallbackNotice?: string }> {
    const post = (m: string) =>
      firstValueFrom(
        this.httpService.post(
          `${this.mlServiceUrl}/api/v1/detection/text?model=${m}`,
          { text },
          { headers: this.mlHeaders({ 'Content-Type': 'application/json' }), timeout: 120000 },
        ),
      );
    try {
      const response = await post(model);
      return { mlResult: response.data };
    } catch (e) {
      if (model !== 'bilstm' && this.isBertUnavailableError(e)) {
        this.logger.warn(`ML 503 untuk model ${model}, fallback ke bilstm`);
        try {
          const retry = await post('bilstm');
          return {
            mlResult: retry.data,
            fallbackNotice: 'Model bert belum tersedia, dipakai bilstm sebagai fallback.',
          };
        } catch (e2) {
          this.mapMlError(e2, 'Klasifikasi teks gagal diproses.');
        }
      }
      this.mapMlError(e, 'Klasifikasi teks gagal diproses.');
    }
  }

  private async callMlImageResilient(
    buffer: Buffer,
    filename: string,
    mimetype: string,
    model: DetectionModelChoice,
  ): Promise<{ mlResult: any; fallbackNotice?: string }> {
    const post = (m: string) => {
      const form = new FormData();
      form.append('file', buffer, { filename, contentType: mimetype });
      return firstValueFrom(
        this.httpService.post(`${this.mlServiceUrl}/api/v1/detection/upload?model=${m}`, form, {
          headers: this.mlHeaders(form.getHeaders()),
          timeout: 120000,
        }),
      );
    };
    try {
      const response = await post(model);
      return { mlResult: response.data };
    } catch (e) {
      if (model !== 'bilstm' && this.isBertUnavailableError(e)) {
        this.logger.warn(`ML 503 untuk model ${model}, fallback ke bilstm`);
        try {
          const retry = await post('bilstm');
          return {
            mlResult: retry.data,
            fallbackNotice: 'Model bert belum tersedia, dipakai bilstm sebagai fallback.',
          };
        } catch (e2) {
          this.mapMlError(e2, 'Deteksi gambar gagal diproses.');
        }
      }
      this.mapMlError(e, 'Deteksi gambar gagal diproses.');
    }
  }

  /** Snapshot SSE dari baris deteksi (dipakai replay stream + idempotency cache). */
  private snapshotFromDetection(
    detection: any,
    remaining: number | null,
    requestedModel?: string,
  ): DetectionJobSnapshot {
    const raw = detection?.rawModelOutput ?? {};
    const ocrText = detection?.ocrText ?? raw?.ocr_text ?? '';
    const lines = countOcrLines(ocrText);
    const allergens = raw?.allergens;
    return {
      remaining,
      model: requestedModel ?? detection?.modelName,
      lines,
      backend: detection?.modelName ?? raw?.model_name,
      count: Array.isArray(allergens) ? allergens.length : 0,
      detectionId: detection?.id,
      ocrQuality: computeOcrQuality(Buffer.byteLength(String(ocrText), 'utf8'), ocrText, lines),
    };
  }

  async detectPublicFromText(opts: {
    text: string;
    modelInput?: string;
    ipHash: string;
    anonId: string;
    idempotencyKey?: string | null;
    uploadId?: string | null;
  }) {
    const model = normalizeModel(opts.modelInput);
    const cacheKey = opts.idempotencyKey || opts.uploadId;
    const cached = this.lookupIdempotency(cacheKey);
    if (cached) {
      const hit = await this.detectionModel.findByPk(cached.detectionId);
      if (hit) {
        if (opts.uploadId) {
          if (!this.getJob(opts.uploadId)) {
            this.createJob(opts.uploadId, {
              kind: 'text',
              ipHash: opts.ipHash,
              anonId: opts.anonId,
              idempotencyKey: opts.idempotencyKey ?? null,
            });
          }
          this.updateJob(opts.uploadId, {
            status: 'done',
            detectionId: hit.id,
            snapshot: this.snapshotFromDetection(hit, cached.remaining, model),
          });
        }
        return { detection: hit, remaining: cached.remaining ?? 0 };
      }
    }
    this.assertQuota(await this.checkPublicQuota(opts.ipHash, opts.anonId));
    const reserved = await this.reservePublicQuota(opts.ipHash, opts.anonId);
    const { remaining, window } = reserved;
    if (opts.uploadId) {
      if (!this.getJob(opts.uploadId)) {
        this.createJob(opts.uploadId, {
          kind: 'text',
          ipHash: opts.ipHash,
          anonId: opts.anonId,
          idempotencyKey: opts.idempotencyKey ?? null,
        });
      }
      this.updateJob(opts.uploadId, {
        status: 'quota_reserved',
        ipHash: opts.ipHash,
        anonId: opts.anonId,
        quotaWindow: window,
        remaining,
      });
    }
    let mlResult: any;
    let fallbackNotice: string | undefined;
    try {
      ({ mlResult, fallbackNotice } = await this.callMlTextResilient(opts.text, model));
    } catch (e) {
      if (this.isRefundableMlError(e)) {
        await this.refundPublicQuota(opts.ipHash, opts.anonId, window);
        if (opts.uploadId) this.updateJob(opts.uploadId, { refunded: true });
      }
      throw e;
    }
    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      await this.refundPublicQuota(opts.ipHash, opts.anonId, window);
      if (opts.uploadId) this.updateJob(opts.uploadId, { refunded: true });
      throw new InternalServerErrorException('Respons ML tidak valid');
    }
    this.assertJobAlive(opts.uploadId);
    const { modelName, method } = this.mlResultMeta(mlResult, model, 'text_input');
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
      detectionMethod: method,
      modelName,
    } as any);
    await this.linkAllergens((detection as any).id, mlResult.allergens);
    if (opts.uploadId) {
      const lines = countOcrLines(opts.text);
      this.updateJob(opts.uploadId, {
        status: 'done',
        detectionId: (detection as any).id,
        fallbackNotice,
        snapshot: {
          remaining,
          model,
          lines,
          backend: modelName,
          count: Array.isArray(mlResult.allergens) ? mlResult.allergens.length : 0,
          detectionId: (detection as any).id,
          ocrQuality: computeOcrQuality(Buffer.byteLength(opts.text || '', 'utf8'), opts.text, lines),
          fallbackNotice,
        },
      });
    }
    this.saveIdempotency(opts.idempotencyKey, (detection as any).id, remaining);
    if (opts.uploadId && opts.uploadId !== opts.idempotencyKey) {
      this.saveIdempotency(opts.uploadId, (detection as any).id, remaining);
    }
    if (fallbackNotice) this.logger.warn(`Fallback ML: ${fallbackNotice}`);
    return { detection, remaining };
  }

  async detectPublicFromImage(opts: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
    modelInput?: string;
    ipHash: string;
    anonId: string;
    idempotencyKey?: string | null;
    uploadId?: string | null;
  }) {
    const model = normalizeModel(opts.modelInput);
    const cacheKey = opts.idempotencyKey || opts.uploadId;
    const cached = this.lookupIdempotency(cacheKey);
    if (cached) {
      const hit = await this.detectionModel.findByPk(cached.detectionId);
      if (hit) {
        if (opts.uploadId) {
          if (!this.getJob(opts.uploadId)) {
            this.createJob(opts.uploadId, {
              kind: 'image',
              ipHash: opts.ipHash,
              anonId: opts.anonId,
              idempotencyKey: opts.idempotencyKey ?? null,
            });
          }
          this.updateJob(opts.uploadId, {
            status: 'done',
            detectionId: hit.id,
            snapshot: this.snapshotFromDetection(hit, cached.remaining, model),
          });
        }
        return { detection: hit, remaining: cached.remaining ?? 0 };
      }
    }
    this.assertQuota(await this.checkPublicQuota(opts.ipHash, opts.anonId));
    const reserved = await this.reservePublicQuota(opts.ipHash, opts.anonId);
    const { remaining, window } = reserved;
    if (opts.uploadId) {
      if (!this.getJob(opts.uploadId)) {
        this.createJob(opts.uploadId, {
          kind: 'image',
          ipHash: opts.ipHash,
          anonId: opts.anonId,
          idempotencyKey: opts.idempotencyKey ?? null,
        });
      }
      this.updateJob(opts.uploadId, {
        status: 'quota_reserved',
        ipHash: opts.ipHash,
        anonId: opts.anonId,
        quotaWindow: window,
        remaining,
      });
    }
    let mlResult: any;
    let fallbackNotice: string | undefined;
    try {
      ({ mlResult, fallbackNotice } = await this.callMlImageResilient(
        opts.buffer,
        opts.filename,
        opts.mimetype,
        model,
      ));
    } catch (e) {
      if (this.isRefundableMlError(e)) {
        await this.refundPublicQuota(opts.ipHash, opts.anonId, window);
        if (opts.uploadId) this.updateJob(opts.uploadId, { refunded: true });
      }
      throw e;
    }
    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      await this.refundPublicQuota(opts.ipHash, opts.anonId, window);
      if (opts.uploadId) this.updateJob(opts.uploadId, { refunded: true });
      throw new InternalServerErrorException('Respons ML tidak valid');
    }
    this.assertJobAlive(opts.uploadId);
    await this.persistUpload(opts.filename, opts.buffer);
    const { modelName, method } = this.mlResultMeta(mlResult, model, 'image_ocr');
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
      detectionMethod: method,
      modelName,
    } as any);
    await this.linkAllergens((detection as any).id, mlResult.allergens);
    if (opts.uploadId) {
      const lines = countOcrLines(mlResult.ocr_text);
      this.updateJob(opts.uploadId, {
        status: 'done',
        detectionId: (detection as any).id,
        fallbackNotice,
        snapshot: {
          remaining,
          model,
          lines,
          backend: modelName,
          count: Array.isArray(mlResult.allergens) ? mlResult.allergens.length : 0,
          detectionId: (detection as any).id,
          ocrQuality: computeOcrQuality(opts.buffer.length, mlResult.ocr_text, lines),
          fallbackNotice,
        },
      });
    }
    this.saveIdempotency(opts.idempotencyKey, (detection as any).id, remaining);
    if (opts.uploadId && opts.uploadId !== opts.idempotencyKey) {
      this.saveIdempotency(opts.uploadId, (detection as any).id, remaining);
    }
    if (fallbackNotice) this.logger.warn(`Fallback ML: ${fallbackNotice}`);
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
