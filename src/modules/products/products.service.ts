import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Product } from './models/product.model';
import { Ingredient } from '../ingredients/models/ingredient.model';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product)
    private productModel: typeof Product,
  ) {}

  async findAll(page = 1, limit = 10, search?: string) {
    const offset = (page - 1) * limit;
    const where: any = { isActive: true };
    if (search) {
      where.name = { [Op.like]: `%${search}%` };
    }
    const { rows, count } = await this.productModel.findAndCountAll({
      where,
      include: ['category', 'ingredients'],
      offset,
      limit,
      order: [['createdAt', 'DESC']],
    });
    return { data: rows, total: count, page, limit, totalPages: Math.ceil(count / limit) };
  }

  async findById(id: number) {
    const product = await this.productModel.findByPk(id, {
      include: ['category', 'ingredients'],
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(dto: CreateProductDto) {
    return this.productModel.create(dto as any);
  }

  async update(id: number, dto: UpdateProductDto) {
    const product = await this.findById(id);
    await product.update(dto);
    return product;
  }

  async remove(id: number) {
    const product = await this.findById(id);
    await product.destroy();
    return { message: 'Product deleted' };
  }
}
