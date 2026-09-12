import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { HttpModule } from '@nestjs/axios';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import { Detection } from './models/detection.model';
import { DetectionAllergen } from './models/detection-allergen.model';
import { Allergen } from '../allergens/models/allergen.model';
import { AllergensModule } from '../allergens/allergens.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Detection, DetectionAllergen, Allergen]),
    HttpModule.register({ timeout: 120000 }),
    AllergensModule,
  ],
  controllers: [DetectionsController],
  providers: [DetectionsService],
  exports: [DetectionsService],
})
export class DetectionsModule {}
