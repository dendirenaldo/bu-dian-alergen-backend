import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../users/models/user.model';
import { Product } from '../products/models/product.model';
import { Detection } from '../detections/models/detection.model';
import { Allergen } from '../allergens/models/allergen.model';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(User) private userModel: typeof User,
    @InjectModel(Product) private productModel: typeof Product,
    @InjectModel(Detection) private detectionModel: typeof Detection,
    @InjectModel(Allergen) private allergenModel: typeof Allergen,
  ) {}

  async getStats() {
    const [totalUsers, totalProducts, totalDetections, totalAllergens] = await Promise.all([
      this.userModel.count(),
      this.productModel.count(),
      this.detectionModel.count(),
      this.allergenModel.count(),
    ]);

    const safeCount = await this.detectionModel.count({ where: { result: 'safe' } });
    const unsafeCount = await this.detectionModel.count({ where: { result: 'unsafe' } });

    return {
      totalUsers,
      totalProducts,
      totalDetections,
      totalAllergens,
      safeCount,
      unsafeCount,
    };
  }

  async getRecentDetections(limit = 10) {
    return this.detectionModel.findAll({
      include: [
        { model: User, attributes: { exclude: ['password'] } },
        'product',
      ],
      limit,
      order: [['createdAt', 'DESC']],
    });
  }

  /** Tren harian deteksi aman/berbahaya selama N hari terakhir (default 14). */
  async getTrend(days = 14) {
    const safeDays = Number.isFinite(days) ? Math.min(Math.max(Math.floor(days), 7), 90) : 14;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (safeDays - 1));

    // Agregasi di JS (portabel MySQL/SQLite, hindari fn DATE + underscored).
    const rows = await this.detectionModel.findAll({
      attributes: ['result', 'createdAt'],
      where: { createdAt: { [Op.gte]: start } },
      raw: true,
    });

    const counts = new Map<string, { safe: number; unsafe: number }>();
    for (const r of rows as unknown as Array<{ result: string; createdAt: Date | string }>) {
      const key = new Date(r.createdAt).toISOString().slice(0, 10);
      const c = counts.get(key) ?? { safe: 0, unsafe: 0 };
      if (r.result === 'safe') c.safe++;
      else if (r.result === 'unsafe') c.unsafe++;
      counts.set(key, c);
    }

    const trend: Array<{ date: string; safe: number; unsafe: number; total: number }> = [];
    for (let i = 0; i < safeDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const c = counts.get(key) ?? { safe: 0, unsafe: 0 };
      trend.push({ date: key, safe: c.safe, unsafe: c.unsafe, total: c.safe + c.unsafe });
    }
    return { days: safeDays, trend };
  }
}
