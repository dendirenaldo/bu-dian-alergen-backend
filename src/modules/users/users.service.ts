import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcrypt';
import { User } from './models/user.model';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
  ) {}

  async findAll(page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const { rows, count } = await this.userModel.findAndCountAll({
      offset,
      limit,
      order: [['createdAt', 'DESC']],
      attributes: { exclude: ['password'] },
    });
    return { data: rows, total: count, page, limit, totalPages: Math.ceil(count / limit) };
  }

  async findById(id: number) {
    const user = await this.userModel.findByPk(id, {
      attributes: { exclude: ['password'] },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByIdWithPassword(id: number) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ where: { email } });
  }

  async create(dto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    return this.userModel.create({ ...dto, password: hashedPassword } as any);
  }

  async update(id: number, dto: UpdateUserDto) {
    const user = await this.findById(id);
    const payload: any = { ...dto };
    // Hash password terpusat di sini agar tidak double-hash / plaintext.
    if (payload.password) {
      payload.password = await bcrypt.hash(payload.password, 10);
    }
    await user.update(payload);
    return user;
  }

  async remove(id: number) {
    const user = await this.findById(id);
    await user.destroy();
    return { message: 'User deleted' };
  }

  async updateLastLogin(id: number) {
    await this.userModel.update({ lastLoginAt: new Date() }, { where: { id } });
  }
}
