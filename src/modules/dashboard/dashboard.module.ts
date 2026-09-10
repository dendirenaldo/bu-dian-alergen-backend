import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { User } from '../users/models/user.model';
import { Product } from '../products/models/product.model';
import { Detection } from '../detections/models/detection.model';
import { Allergen } from '../allergens/models/allergen.model';

@Module({
  imports: [SequelizeModule.forFeature([User, Product, Detection, Allergen])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
