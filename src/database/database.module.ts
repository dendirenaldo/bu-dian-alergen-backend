import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { databaseConfig } from '../config/database.config';

@Module({
  imports: [SequelizeModule.forRoot(databaseConfig())],
})
export class DatabaseModule {}
