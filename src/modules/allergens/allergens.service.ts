import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Allergen } from './models/allergen.model';
import { CreateAllergenDto } from './dto/create-allergen.dto';
import { UpdateAllergenDto } from './dto/update-allergen.dto';

@Injectable()
export class AllergensService {
  constructor(
    @InjectModel(Allergen)
    private allergenModel: typeof Allergen,
  ) {}

  async findAll() {
    return this.allergenModel.findAll({
      where: { isActive: true },
      order: [['name', 'ASC']],
    });
  }

  async findById(id: number) {
    const allergen = await this.allergenModel.findByPk(id);
    if (!allergen) throw new NotFoundException('Allergen not found');
    return allergen;
  }

  async create(dto: CreateAllergenDto) {
    const name = dto.name.trim();
    const code = dto.code.trim().toUpperCase();
    try {
      const existing = await this.allergenModel.findOne({
        where: { [Op.or]: [{ name }, { code }] },
      });
      if (existing) throw new ConflictException('Nama/kode alergen sudah dipakai');
      return await this.allergenModel.create({ ...dto, name, code } as any);
    } catch (e) {
      if (e?.name === 'SequelizeUniqueConstraintError') {
        throw new ConflictException('Nama/kode alergen sudah dipakai');
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateAllergenDto) {
    const allergen = await this.findById(id);
    const payload: any = { ...dto };
    if (payload.name) payload.name = String(payload.name).trim();
    if (payload.code) payload.code = String(payload.code).trim().toUpperCase();
    await allergen.update(payload);
    return allergen;
  }

  async remove(id: number) {
    const allergen = await this.findById(id);
    await allergen.destroy();
    return { message: 'Allergen deleted' };
  }
}
