import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
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
import { firstValueFrom } from 'rxjs';
import { Detection } from './models/detection.model';
import { DetectionAllergen } from './models/detection-allergen.model';
import { Allergen } from '../allergens/models/allergen.model';
import { Product } from '../products/models/product.model';
import { User } from '../users/models/user.model';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FormData = require('form-data');

@Injectable()
export class DetectionsService {
  private readonly logger = new Logger(DetectionsService.name);

  constructor(
    @InjectModel(Detection)
    private detectionModel: typeof Detection,
    @InjectModel(DetectionAllergen)
    private detectionAllergenModel: typeof DetectionAllergen,
    @InjectModel(Allergen)
    private allergenModel: typeof Allergen,
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
    if (status === 503) throw new ServiceUnavailableException('Model ML belum siap, coba lagi nanti');
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

  async detectFromImage(userId: number, imageBuffer: Buffer, filename: string, mimetype = 'image/jpeg') {
    const form = new FormData();
    // Nama field 'file' sesuai kontrak ML (app/api/routers/detection.py).
    form.append('file', imageBuffer, { filename, contentType: mimetype });

    let mlResult: any;
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.mlServiceUrl}/api/v1/detection/upload`, form, {
          headers: this.mlHeaders(form.getHeaders()),
          timeout: 120000,
        }),
      );
      mlResult = response.data;
    } catch (e) {
      this.mapMlError(e, 'Deteksi gambar gagal diproses.');
    }

    if (!mlResult?.result || !['safe', 'unsafe'].includes(mlResult.result)) {
      throw new InternalServerErrorException('Respons ML tidak valid');
    }

    await this.persistUpload(filename, imageBuffer);

    const detection = await this.detectionModel.create({
      userId,
      imageUrl: `/uploads/${filename}`,
      ocrText: mlResult.ocr_text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score ?? 0,
      processingTimeMs: mlResult.processing_time_ms ?? null,
      detectionMethod: 'image_ocr',
    } as any);

    await this.linkAllergens(detection.id, mlResult.allergens);

    return detection;
  }

  async detectFromText(userId: number, text: string) {
    let mlResult: any;
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.mlServiceUrl}/api/v1/detection/text`,
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

    const detection = await this.detectionModel.create({
      userId,
      ocrText: text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score ?? 0,
      processingTimeMs: mlResult.processing_time_ms ?? null,
      detectionMethod: 'text_input',
    } as any);

    await this.linkAllergens(detection.id, mlResult.allergens);

    return detection;
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
        { model: DetectionAllergen, as: 'detectionAllergens' },
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
    if (!userId || detection.userId !== Number(userId)) {
      throw new ForbiddenException('Anda tidak berhak mengakses data ini');
    }
  }

  async findById(id: number, userId?: number, role?: string) {
    const detection = await this.detectionModel.findByPk(id, {
      include: [
        { model: User, as: 'user', attributes: { exclude: ['password'] } },
        { model: Product, as: 'product' },
        { model: DetectionAllergen, as: 'detectionAllergens' },
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
