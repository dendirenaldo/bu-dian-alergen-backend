import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Setting } from './models/setting.model';
import { SettingType } from '../../common/enums/setting.enum';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Setting)
    private settingModel: typeof Setting,
  ) {}

  async findAll() {
    return this.settingModel.findAll({ order: [['key', 'ASC']] });
  }

  async findByKey(key: string) {
    const setting = await this.settingModel.findOne({ where: { key } });
    if (!setting) throw new NotFoundException('Setting not found');
    return setting;
  }

  async set(key: string, value: string, type: string = SettingType.String, description?: string) {
    const cleanKey = String(key).trim();
    const [setting] = await this.settingModel.findOrCreate({
      where: { key: cleanKey },
      defaults: { value, type, description } as any,
    });
    const patch: any = { value };
    if (type !== undefined) patch.type = type;
    // Jangan timpa description jadi NULL saat tidak dikirim.
    if (description !== undefined) patch.description = description;
    await setting.update(patch);
    return setting;
  }
}
