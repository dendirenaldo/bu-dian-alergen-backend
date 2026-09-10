import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ingredient } from './models/ingredient.model';

@Injectable()
export class IngredientsService {
  constructor(
    @InjectModel(Ingredient)
    private ingredientModel: typeof Ingredient,
  ) {}

  async findByProductId(productId: number) {
    return this.ingredientModel.findAll({ where: { productId } });
  }

  async create(data: { productId: number; text: string }) {
    return this.ingredientModel.create(data);
  }

  async bulkCreate(productId: number, texts: string[]) {
    const ingredients = texts.map(text => ({ productId, text }));
    return this.ingredientModel.bulkCreate(ingredients);
  }
}
