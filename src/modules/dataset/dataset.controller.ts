import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { DatasetService } from './dataset.service';
import { DatasetQueryDto } from './dto/dataset-query.dto';
import { UpdateDatasetItemDto } from './dto/update-dataset-item.dto';
import { DatasetDownloadQueryDto, DatasetExportQueryDto } from './dto/dataset-export-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('dataset')
@Controller('dataset-items')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DatasetController {
  constructor(private datasetService: DatasetService) {}

  @Get('export')
  @Roles(Role.Admin)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: ekspor dataset (default hanya verified) csv/json' })
  async export(@Query() query: DatasetExportQueryDto, @Res() res: Response, @CurrentUser() user: any) {
    await this.datasetService.exportToResponse(query, res, user?.sub);
  }

  @Get('download/estimate')
  @Roles(Role.Admin)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: estimasi ukuran ZIP dataset' })
  estimate(@Query() query: DatasetDownloadQueryDto) {
    return this.datasetService.estimateDownload(query);
  }

  @Get('download')
  @Roles(Role.Admin)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: unduh ZIP dataset (dataset.csv + manifest + images + split + readme)' })
  async download(@Query() query: DatasetDownloadQueryDto, @Res() res: Response, @CurrentUser() user: any) {
    await this.datasetService.downloadToResponse(query, res, user?.sub);
  }

  @Get()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Admin: list dataset items' })
  findAll(@Query() query: DatasetQueryDto) {
    return this.datasetService.findAll(query);
  }

  @Patch(':id')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Admin: update dataset item' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDatasetItemDto,
    @CurrentUser() user: any,
  ) {
    return this.datasetService.update(id, dto, user?.sub);
  }

  @Patch(':id/verify')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Admin: tandai dataset item verified' })
  verify(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.datasetService.markVerified(id, user?.sub);
  }

  @Patch(':id/unverify')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Admin: kembalikan dataset item ke draft' })
  unverify(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.datasetService.unmarkVerified(id, user?.sub);
  }

  @Delete(':id')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Admin: hapus dataset item' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.datasetService.remove(id, user?.sub);
  }
}
