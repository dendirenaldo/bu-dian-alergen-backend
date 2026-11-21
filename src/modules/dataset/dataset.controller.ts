import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { DatasetService } from './dataset.service';
import { DatasetExportService } from './dataset-export.service';
import { AuditLogService } from './audit-log.service';
import { DatasetQueryDto } from './dto/dataset-query.dto';
import { CreateDatasetItemDto } from './dto/create-dataset-item.dto';
import { UpdateDatasetItemDto } from './dto/update-dataset-item.dto';
import { DatasetReviewDto } from './dto/dataset-review.dto';
import { DatasetDownloadQueryDto, DatasetExportQueryDto } from './dto/dataset-export-query.dto';
import { CreateDatasetExportDto } from './dto/dataset-export.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const imageUpload = FileInterceptor('image', {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

@ApiTags('dataset')
@Controller('dataset-items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@ApiBearerAuth()
export class DatasetController {
  constructor(
    private datasetService: DatasetService,
    private exportService: DatasetExportService,
    private auditService: AuditLogService,
  ) {}

  // ---- Statistik & ekspor berprofil (rute statis dulu) -----------------
  @Get('statistics')
  @ApiOperation({ summary: 'Admin: statistik operasional dataset' })
  statistics() {
    return this.datasetService.statistics();
  }

  @Get('exports/summary')
  @ApiOperation({ summary: 'Admin: ringkasan riwayat ekspor' })
  exportsSummary() {
    return this.exportService.summary();
  }

  @Get('exports')
  @ApiOperation({ summary: 'Admin: riwayat ekspor' })
  listExports(@Query() query: PaginationQueryDto) {
    return this.exportService.list(query);
  }

  @Get('exports/:id/download')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: unduh ulang ekspor dari riwayat' })
  async downloadExport(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { abs, filename } = await this.exportService.getForDownload(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(abs);
  }

  @Post('exports/preview')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: pratinjau seleksi & validasi ekspor tanpa menghasilkan ZIP' })
  previewExport(@Body() dto: CreateDatasetExportDto) {
    return this.exportService.preview(dto);
  }

  @Post('exports')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: buat ekspor dataset berprofil (raw/nlp/image/multimodal)' })
  createExport(@Body() dto: CreateDatasetExportDto, @CurrentUser() user: any) {
    return this.exportService.create(dto, user?.sub);
  }

  // ---- Ekspor lama (backward compatible) -------------------------------
  @Get('export')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: ekspor CSV/JSON lama (default hanya verified)' })
  async export(@Query() query: DatasetExportQueryDto, @Res() res: Response, @CurrentUser() user: any) {
    await this.datasetService.exportToResponse(query, res, user?.sub);
  }

  @Get('download/estimate')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: estimasi ukuran ZIP dataset (format lama)' })
  estimate(@Query() query: DatasetDownloadQueryDto) {
    return this.datasetService.estimateDownload(query);
  }

  @Get('download')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: unduh ZIP dataset format lama' })
  async download(@Query() query: DatasetDownloadQueryDto, @Res() res: Response, @CurrentUser() user: any) {
    await this.datasetService.downloadToResponse(query, res, user?.sub);
  }

  // ---- CRUD & workflow -------------------------------------------------
  @Get()
  @ApiOperation({ summary: 'Admin: list dataset items' })
  findAll(@Query() query: DatasetQueryDto) {
    return this.datasetService.findAll(query);
  }

  @Post()
  @ApiOperation({ summary: 'Admin: buat record dataset manual' })
  create(@Body() dto: CreateDatasetItemDto, @CurrentUser() user: any) {
    return this.datasetService.create(dto, user?.sub);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Admin: riwayat audit record dataset' })
  history(@Param('id', ParseIntPipe) id: number) {
    return this.auditService.history(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Admin: detail dataset item' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.datasetService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin: update dataset item' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDatasetItemDto,
    @CurrentUser() user: any,
  ) {
    return this.datasetService.update(id, dto, user?.sub);
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Admin: aksi review (submit/verify/approve/reject/request_correction/archive)' })
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DatasetReviewDto,
    @CurrentUser() user: any,
  ) {
    return this.datasetService.review(id, dto, user?.sub);
  }

  @Post(':id/image')
  @UseInterceptors(imageUpload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Admin: unggah/ganti gambar record dataset' })
  uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('image_type') imageType: string,
    @CurrentUser() user: any,
  ) {
    return this.datasetService.uploadImage(id, file, user?.sub, imageType);
  }

  @Patch(':id/verify')
  @ApiOperation({ summary: 'Admin: tandai dataset item verified' })
  verify(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.datasetService.markVerified(id, user?.sub);
  }

  @Patch(':id/unverify')
  @ApiOperation({ summary: 'Admin: kembalikan dataset item ke needs_correction' })
  unverify(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.datasetService.unmarkVerified(id, user?.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Admin: hapus dataset item' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.datasetService.remove(id, user?.sub);
  }
}
