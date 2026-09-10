import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
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
}
