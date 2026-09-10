import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Content } from './models/content.model';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';

@Injectable()
export class ContentsService {
  constructor(
    @InjectModel(Content)
    private contentModel: typeof Content,
  ) {}

  async findAll(type?: string, status?: string, isAdmin = false) {
    const where: any = {};
    if (type) where.type = type;
    if (status) {
      where.status = status;
    } else if (!isAdmin) {
      where.status = 'published';
    }
    return this.contentModel.findAll({ where, order: [['createdAt', 'DESC']] });
  }

  async findBySlug(slug: string) {
    const content = await this.contentModel.findOne({ where: { slug } });
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }

  async findById(id: number) {
    const content = await this.contentModel.findByPk(id);
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }

  async create(dto: CreateContentDto, createdBy?: number) {
    const existing = await this.contentModel.findOne({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('Slug already exists');
    return this.contentModel.create({ ...dto, createdBy } as any);
  }

  async update(id: number, dto: UpdateContentDto) {
    const content = await this.findById(id);
    await content.update(dto);
    return content;
  }

  async remove(id: number) {
    const content = await this.findById(id);
    await content.destroy();
    return { message: 'Content deleted' };
  }
}
