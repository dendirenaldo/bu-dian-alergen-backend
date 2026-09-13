import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Category } from './models/category.model';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { slugify } from '../../common/utils/slug.util';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category)
    private categoryModel: typeof Category,
    @InjectConnection() private sequelize: Sequelize,
  ) {}

  async findAll() {
    return this.categoryModel.findAll({
      where: { isActive: true },
      order: [['sortOrder', 'ASC']],
    });
  }

  async findById(id: number) {
    const category = await this.categoryModel.findByPk(id);
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async findBySlug(slug: string) {
    const category = await this.categoryModel.findOne({ where: { slug } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CreateCategoryDto) {
    const slug = dto.slug?.trim() || slugify(dto.name);
    const name = dto.name.trim();
    try {
      return await this.sequelize.transaction(async (t) => {
        const existing = await this.categoryModel.findOne({
          where: { name },
          transaction: t,
        });
        if (existing) throw new ConflictException('Category name already exists');
        const slugExists = await this.categoryModel.findOne({ where: { slug }, transaction: t });
        if (slugExists) throw new ConflictException('Slug kategori sudah dipakai');
        return this.categoryModel.create({ ...dto, name, slug } as any, { transaction: t });
      });
    } catch (e) {
      if (e?.name === 'SequelizeUniqueConstraintError') {
        throw new ConflictException('Kategori sudah terdaftar (duplikat)');
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const category = await this.findById(id);
    const payload: any = { ...dto };
    if (payload.name) payload.name = String(payload.name).trim();
    if (payload.slug) payload.slug = slugify(String(payload.slug));
    await category.update(payload);
    return category;
  }

  async remove(id: number) {
    const category = await this.findById(id);
    await category.destroy();
    return { message: 'Category deleted' };
  }
}
