import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DatasetService } from './dataset.service';
import { DatasetExportService } from './dataset-export.service';
import { DatasetValidationService } from './dataset-validation.service';
import { DatasetController } from './dataset.controller';
import { DatasetItem } from './models/dataset-item.model';
import { DatasetExport } from './models/dataset-export.model';
import { Detection } from '../detections/models/detection.model';
import { DetectionAllergen } from '../detections/models/detection-allergen.model';
import { Allergen } from '../allergens/models/allergen.model';
import { Product } from '../products/models/product.model';
import { User } from '../users/models/user.model';
import { AuditLog } from './models/audit-log.model';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      DatasetItem,
      DatasetExport,
      Detection,
      DetectionAllergen,
      Allergen,
      Product,
      User,
      AuditLog,
    ]),
  ],
  controllers: [DatasetController],
  providers: [
    DatasetService,
    DatasetExportService,
    DatasetValidationService,
    AuditLogService,
    { provide: 'AUDIT_LOG_SERVICE', useExisting: AuditLogService },
  ],
  exports: [DatasetService, DatasetExportService],
})
export class DatasetModule {}
