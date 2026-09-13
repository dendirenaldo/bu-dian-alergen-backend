import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ingredient } from './models/ingredient.model';

@Injectable()
export class IngredientsService {
  constructor(
    @InjectModel(Ingredient)
    private ingredientModel: typeof Ingredient,
  ) {}

  async findByProductId(productId: number) {
    return this.ingredientModel.findAll({ where: { productId }, order: [['id', 'ASC']] });
  }

  async create(data: { productId: number; text: string }) {
    const text = String(data.text).trim();
    if (!text) throw new NotFoundException('Teks bahan tidak boleh kosong');
    return this.ingredientModel.create({ productId: data.productId, text } as any);
  }

  async bulkCreate(productId: number, texts: string[]) {
    const clean = [...new Set(texts.map((t) => String(t).trim()).filter(Boolean))];
    if (!clean.length) return [];
    const ingredients = clean.map((text) => ({ productId, text }));
    return this.ingredientModel.bulkCreate(ingredients as any);
  }

  async remove(id: number) {
    const item = await this.ingredientModel.findByPk(id);
    if (!item) throw new NotFoundException('Ingredient not found');
    await item.destroy();
    return { message: 'Ingredient deleted' };
  }
}
