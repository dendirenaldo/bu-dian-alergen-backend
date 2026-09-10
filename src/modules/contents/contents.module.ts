import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ContentsService } from './contents.service';
import { ContentsController } from './contents.controller';
import { Content } from './models/content.model';

@Module({
  imports: [SequelizeModule.forFeature([Content])],
  controllers: [ContentsController],
  providers: [ContentsService],
  exports: [ContentsService],
})
export class ContentsModule {}
