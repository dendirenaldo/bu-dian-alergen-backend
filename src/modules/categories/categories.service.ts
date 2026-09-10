import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Category } from './models/category.model';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category)
    private categoryModel: typeof Category,
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
    const existing = await this.categoryModel.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Category name already exists');
    return this.categoryModel.create(dto as any);
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const category = await this.findById(id);
    await category.update(dto);
    return category;
  }

  async remove(id: number) {
    const category = await this.findById(id);
    await category.destroy();
    return { message: 'Category deleted' };
  }
}
