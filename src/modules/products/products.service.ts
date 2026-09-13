import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Product } from './models/product.model';
import { Ingredient } from '../ingredients/models/ingredient.model';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { slugify } from '../../common/utils/slug.util';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product)
    private productModel: typeof Product,
    @InjectConnection() private sequelize: Sequelize,
  ) {}

  async findAll(page = 1, limit = 10, search?: string) {
    const safePage = Number.isFinite(+page) && +page > 0 ? Math.floor(+page) : 1;
    const safeLimit = Number.isFinite(+limit) && +limit > 0 ? Math.min(Math.floor(+limit), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const where: any = {};
    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      where[Op.or] = [
        { name: { [Op.like]: q } },
        { brand: { [Op.like]: q } },
        { barcode: { [Op.like]: q } },
      ];
    }
    const { rows, count } = await this.productModel.findAndCountAll({
      where,
      include: ['category', 'ingredients'],
      offset,
      limit: safeLimit,
      order: [['createdAt', 'DESC']],
    });
    return { data: rows, total: count, page: safePage, limit: safeLimit, totalPages: Math.ceil(count / safeLimit) };
  }

  async findById(id: number) {
    const product = await this.productModel.findByPk(id, {
      include: ['category', 'ingredients'],
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(dto: CreateProductDto, createdBy?: number) {
    const { ingredients, ...rest } = dto as any;
    const name = String(rest.name).trim();
    const slug = rest.slug?.trim() || slugify(name);
    try {
      return await this.sequelize.transaction(async (t) => {
        const product = await this.productModel.create(
          { ...rest, name, slug, createdBy: createdBy ?? null } as any,
          { transaction: t },
        );
        if (ingredients && Array.isArray(ingredients) && ingredients.length) {
          const clean = [...new Set(ingredients.map((s: string) => String(s).trim()).filter(Boolean))];
          if (clean.length) {
            await Ingredient.bulkCreate(
              clean.map((text: string) => ({ productId: product.id, text })),
              { transaction: t } as any,
            );
          }
        }
        return product;
      }).then((p) => this.findById(p.id));
    } catch (e) {
      if (e?.name === 'SequelizeUniqueConstraintError') {
        throw new ConflictException('Produk/barcode/slug sudah terdaftar');
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateProductDto) {
    const product = await this.findById(id);
    const payload: any = { ...(dto as any) };
    delete payload.ingredients;
    delete payload.createdBy;
    if (payload.name) payload.name = String(payload.name).trim();
    if (payload.slug) payload.slug = slugify(String(payload.slug));
    if (payload.barcode === '') payload.barcode = null;
    await product.update(payload);
    return this.findById(id);
  }

  async remove(id: number) {
    const product = await this.findById(id);
    await product.destroy();
    return { message: 'Product deleted' };
  }
}
