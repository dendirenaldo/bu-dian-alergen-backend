import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Content } from './models/content.model';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ContentsQueryDto } from './dto/contents-query.dto';
import { ContentStatus } from '../../common/enums/content.enum';
import { slugify } from '../../common/utils/slug.util';

@Injectable()
export class ContentsService {
  constructor(
    @InjectModel(Content)
    private contentModel: typeof Content,
  ) {}

  async findAll(query: ContentsQueryDto = {}, isAdmin = false) {
    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.status) {
      // User publik tidak boleh intip draft/archived via query.
      where.status = isAdmin ? query.status : ContentStatus.Published;
    } else if (!isAdmin) {
      where.status = ContentStatus.Published;
    }
    return this.contentModel.findAll({ where, order: [['createdAt', 'DESC']] });
  }

  async findBySlug(slug: string, isAdmin = false) {
    const content = await this.contentModel.findOne({ where: { slug } });
    if (!content) throw new NotFoundException('Content not found');
    if (!isAdmin && content.status !== ContentStatus.Published) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }

  async findById(id: number) {
    const content = await this.contentModel.findByPk(id);
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }

  async create(dto: CreateContentDto, createdBy?: number) {
    const slug = dto.slug?.trim() || slugify(dto.title);
    try {
      const existing = await this.contentModel.findOne({ where: { slug } });
      if (existing) throw new ConflictException('Slug already exists');
      const payload: any = { ...dto, slug, createdBy: createdBy ?? null };
      if (payload.status === ContentStatus.Published && !payload.publishedAt) {
        payload.publishedAt = new Date();
      }
      return await this.contentModel.create(payload);
    } catch (e) {
      if (e?.name === 'SequelizeUniqueConstraintError') {
        throw new ConflictException('Slug sudah dipakai');
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateContentDto) {
    const content = await this.findById(id);
    const payload: any = { ...dto };
    if (payload.slug) payload.slug = slugify(String(payload.slug));
    if (payload.status === ContentStatus.Published && !content.publishedAt && !payload.publishedAt) {
      payload.publishedAt = new Date();
    }
    await content.update(payload);
    return content;
  }

  async remove(id: number) {
    const content = await this.findById(id);
    await content.destroy();
    return { message: 'Content deleted' };
  }
}
