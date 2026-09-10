import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Detection } from './models/detection.model';
import { DetectionAllergen } from './models/detection-allergen.model';
import { Product } from '../products/models/product.model';
import { User } from '../users/models/user.model';

@Injectable()
export class DetectionsService {
  constructor(
    @InjectModel(Detection)
    private detectionModel: typeof Detection,
    @InjectModel(DetectionAllergen)
    private detectionAllergenModel: typeof DetectionAllergen,
    private httpService: HttpService,
  ) {}

  private get mlServiceUrl() {
    return process.env.ML_SERVICE_URL || 'http://localhost:8000';
  }

  async detectFromImage(userId: number, imageBuffer: Buffer, filename: string) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('image', imageBuffer, { filename });

    const response = await firstValueFrom(
      this.httpService.post(`${this.mlServiceUrl}/api/v1/detection/upload`, form, {
        headers: form.getHeaders(),
        timeout: 120000,
      })
    );

    const mlResult = response.data;
    const detection = await this.detectionModel.create({
      userId,
      imageUrl: `/uploads/${filename}`,
      ocrText: mlResult.ocr_text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score,
      processingTimeMs: mlResult.processing_time_ms,
      detectionMethod: 'image_ocr',
    });

    return detection;
  }

  async detectFromText(userId: number, text: string) {
    const response = await firstValueFrom(
      this.httpService.post(`${this.mlServiceUrl}/api/v1/detection/text`, { text }, {
        timeout: 120000,
      })
    );

    const mlResult = response.data;
    const detection = await this.detectionModel.create({
      userId,
      ocrText: text,
      rawModelOutput: mlResult,
      result: mlResult.result,
      confidenceScore: mlResult.confidence_score,
      processingTimeMs: mlResult.processing_time_ms,
      detectionMethod: 'text_input',
    });

    return detection;
  }

  async findAllByUser(userId: number, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const { rows, count } = await this.detectionModel.findAndCountAll({
      where: { userId },
      include: [
        { model: Product, as: 'product' },
        { model: DetectionAllergen, as: 'detectionAllergens' },
      ],
      offset,
      limit,
      order: [['createdAt', 'DESC']],
    });
    return { data: rows, total: count, page, limit, totalPages: Math.ceil(count / limit) };
  }

  async findById(id: number) {
    const detection = await this.detectionModel.findByPk(id, {
      include: [
        { model: User, as: 'user', attributes: { exclude: ['password'] } },
        { model: Product, as: 'product' },
        { model: DetectionAllergen, as: 'detectionAllergens' },
      ],
    });
    if (!detection) throw new NotFoundException('Detection not found');
    return detection;
  }

  async remove(id: number) {
    const detection = await this.findById(id);
    await detection.destroy();
    return { message: 'Detection deleted' };
  }
}
