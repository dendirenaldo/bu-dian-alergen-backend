import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DatasetService } from './dataset.service';
import { DatasetController } from './dataset.controller';
import { DatasetItem } from './models/dataset-item.model';
import { Detection } from '../detections/models/detection.model';
import { DetectionAllergen } from '../detections/models/detection-allergen.model';
import { Allergen } from '../allergens/models/allergen.model';
import { Product } from '../products/models/product.model';
import { User } from '../users/models/user.model';

@Module({
  imports: [SequelizeModule.forFeature([DatasetItem, Detection, DetectionAllergen, Allergen, Product, User])],
  controllers: [DatasetController],
  providers: [DatasetService],
  exports: [DatasetService],
})
export class DatasetModule {}
