import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { IngredientsService } from './ingredients.service';
import { IngredientsController } from './ingredients.controller';
import { Ingredient } from './models/ingredient.model';

@Module({
  imports: [SequelizeModule.forFeature([Ingredient])],
  controllers: [IngredientsController],
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
