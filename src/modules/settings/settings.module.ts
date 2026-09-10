import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SettingsService } from './settings.service';
import { Setting } from './models/setting.model';

@Module({
  imports: [SequelizeModule.forFeature([Setting])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
