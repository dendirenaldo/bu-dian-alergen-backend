import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { HttpModule } from '@nestjs/axios';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import { Detection } from './models/detection.model';
import { DetectionAllergen } from './models/detection-allergen.model';
import { FreeDetectionLog } from './models/free-detection-log.model';
import { FreeDetectionCounter } from './models/free-detection-counter.model';
import { User } from '../users/models/user.model';
import { Allergen } from '../allergens/models/allergen.model';
import { AllergensModule } from '../allergens/allergens.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Detection, DetectionAllergen, Allergen, FreeDetectionLog, FreeDetectionCounter, User]),
    HttpModule.register({ timeout: 120000 }),
    AllergensModule,
  ],
  controllers: [DetectionsController],
  providers: [DetectionsService],
  exports: [DetectionsService],
})
export class DetectionsModule {}
