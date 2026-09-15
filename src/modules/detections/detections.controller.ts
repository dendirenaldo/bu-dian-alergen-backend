import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UploadedFile, UseInterceptors, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { DetectionsService } from './detections.service';
import { DetectTextDto } from './dto/detect-text.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('detections')
@Controller('detections')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DetectionsController {
  constructor(private detectionsService: DetectionsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('image', {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      // Toleran: sebagian klien lama mengirim application/octet-stream tanpa
      // content-type part. Terima bila ekstensi jelas gambar; keaslian bytes
      // tetap dipastikan hilir via magic-byte (ML cv2.imdecode).
      const mimetypeOk = !!file?.mimetype?.startsWith('image/');
      const ext = (file?.originalname || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
      const extOk = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext);
      if (mimetypeOk || extOk) {
        cb(null, true);
      } else {
        cb(
          new BadRequestException(
            `File harus berupa gambar (JPG/PNG/WEBP). Diterima: ${file?.mimetype || 'tanpa tipe'}`,
          ),
          false,
        );
      }
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload image for allergen detection' })
  async upload(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Gambar wajib diunggah');
    }
    const safe = (file.originalname || 'upload.jpg')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .slice(-100);
    const filename = `${Date.now()}-${safe}`;
    return this.detectionsService.detectFromImage(user.sub, file.buffer, filename, file.mimetype);
  }

  @Post('text')
  @ApiOperation({ summary: 'Classify ingredient text' })
  async detectText(
    @CurrentUser() user: any,
    @Body() dto: DetectTextDto,
  ) {
    return this.detectionsService.detectFromText(user.sub, dto.text);
  }

  @Get()
  @ApiOperation({ summary: 'List user detections' })
  findAll(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.detectionsService.findAllByUser(user.sub, pagination.page, pagination.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get detection detail' })
  findOne(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.detectionsService.findById(id, user?.sub, user?.role);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete detection' })
  remove(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.detectionsService.remove(id, user?.sub, user?.role);
  }
}
