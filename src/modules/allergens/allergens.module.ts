import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AllergensService } from './allergens.service';
import { AllergensController } from './allergens.controller';
import { Allergen } from './models/allergen.model';

@Module({
  imports: [SequelizeModule.forFeature([Allergen])],
  controllers: [AllergensController],
  providers: [AllergensService],
  exports: [AllergensService],
})
export class AllergensModule {}
