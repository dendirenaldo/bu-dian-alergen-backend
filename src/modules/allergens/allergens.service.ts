import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
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
    });
  }

  async findById(id: number) {
    const allergen = await this.allergenModel.findByPk(id);
    if (!allergen) throw new NotFoundException('Allergen not found');
    return allergen;
  }

  async create(dto: CreateAllergenDto) {
    const existing = await this.allergenModel.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Allergen name already exists');
    return this.allergenModel.create(dto as any);
  }

  async update(id: number, dto: UpdateAllergenDto) {
    const allergen = await this.findById(id);
    await allergen.update(dto);
    return allergen;
  }

  async remove(id: number) {
    const allergen = await this.findById(id);
    await allergen.destroy();
    return { message: 'Allergen deleted' };
  }
}
