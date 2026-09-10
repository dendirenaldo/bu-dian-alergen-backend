import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { Product } from './models/product.model';
import { ProductAllergen } from './models/product-allergen.model';
import { Ingredient } from '../ingredients/models/ingredient.model';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Product, ProductAllergen, Ingredient]),
    CategoriesModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
