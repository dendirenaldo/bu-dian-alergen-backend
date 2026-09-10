import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Setting } from './models/setting.model';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Setting)
    private settingModel: typeof Setting,
  ) {}

  async findAll() {
    return this.settingModel.findAll();
  }

  async findByKey(key: string) {
    return this.settingModel.findOne({ where: { key } });
  }

  async set(key: string, value: string, type = 'string', description?: string) {
    const [setting] = await this.settingModel.findOrCreate({
      where: { key },
      defaults: { value, type, description },
    });
    await setting.update({ value, type, description });
    return setting;
  }
}
