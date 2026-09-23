import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UploadedFile, UseInterceptors, ParseIntPipe, BadRequestException, Req, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { DetectionsService, FREE_DETECTION_LIMIT, ensureAnonId, extractClientIp, hashIp } from './detections.service';
import { DetectTextDto } from './dto/detect-text.dto';
import { DetectModelQueryDto } from './dto/detect-model.query';
import { AdminDetectionsQueryDto } from './dto/admin-detections.query';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function setAnonCookie(req: Request, res: Response, anonId: string) {
  const existing = (req as any)?.cookies?.['anon_id'];
  if (existing === anonId) return;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // HttpOnly agar tidak bisa dibaca/ditulis JS (anti-tamper ringan).
  // appendHeader agar tidak menimpa Set-Cookie lain.
  res.appendHeader(
    'Set-Cookie',
    `anon_id=${anonId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
  );
}

function publicRateHeaders(res: Response, remaining: number, retryAfterSec = 0) {
  res.setHeader('X-RateLimit-Limit', String(FREE_DETECTION_LIMIT));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  if (retryAfterSec > 0) res.setHeader('Retry-After', String(retryAfterSec));
}

const uploadInterceptor = FileInterceptor('image', {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
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
});

@ApiTags('detections')
@Controller('detections')
export class DetectionsController {
  constructor(private detectionsService: DetectionsService) {}

  // ---------- Tanpa login: hanya bisa 5x per jam (kuota server-side) ----------

  @Get('public/quota')
  @Throttle({ public: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Cek sisa kuota deteksi tanpa login (5x per jam)' })
  async publicQuota(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const anonId = ensureAnonId(req);
    setAnonCookie(req, res, anonId);
    const ipHash = hashIp(extractClientIp(req));
    const q = await this.detectionsService.checkPublicQuota(ipHash, anonId);
    publicRateHeaders(res, q.remaining, q.retryAfterSec);
    return { limit: FREE_DETECTION_LIMIT, remaining: q.remaining, used: q.used };
  }

  // Catatan: limit throttler (6) sengaja 1 di atas kuota MySQL (5) sebagai
  // headroom — request ke-6 selalu dapat pesan Indonesia dari kuota DB
  // (source of truth, tahan multi-instance), bukan 429 generik throttler.
  @Post('public/text')
  @Throttle({ public: { limit: 6, ttl: 3600000 } })
  @ApiOperation({ summary: 'Deteksi teks tanpa login (hanya bisa 5x per jam)' })
  async publicDetectText(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: DetectTextDto,
    @Query() qm: DetectModelQueryDto,
  ) {
    const anonId = ensureAnonId(req);
    setAnonCookie(req, res, anonId);
    const ipHash = hashIp(extractClientIp(req));
    const { detection, remaining } = await this.detectionsService.detectPublicFromText({
      text: dto.text,
      modelInput: qm.model,
      ipHash,
      anonId,
    });
    publicRateHeaders(res, remaining);
    return detection;
  }

  @Post('public/upload')
  @Throttle({ public: { limit: 6, ttl: 3600000 } })
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Deteksi gambar tanpa login (hanya bisa 5x per jam)' })
  async publicUpload(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UploadedFile() file: Express.Multer.File,
    @Query() qm: DetectModelQueryDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Gambar wajib diunggah');
    }
    const anonId = ensureAnonId(req);
    setAnonCookie(req, res, anonId);
    const ipHash = hashIp(extractClientIp(req));
    const safe = (file.originalname || 'upload.jpg')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .slice(-100);
    const filename = `${Date.now()}-${safe}`;
    const { detection, remaining } = await this.detectionsService.detectPublicFromImage({
      buffer: file.buffer,
      filename,
      mimetype: file.mimetype,
      modelInput: qm.model,
      ipHash,
      anonId,
    });
    publicRateHeaders(res, remaining);
    return detection;
  }

  // ---------- Admin: semua riwayat + identitas pemilik ----------

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: semua riwayat deteksi beserta pemiliknya' })
  findAllAdmin(@Query() query: AdminDetectionsQueryDto) {
    return this.detectionsService.findAllAdmin(query);
  }

  // ---------- Tertaut akun (wajib login) ----------

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload image for allergen detection' })
  async upload(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Query() qm: DetectModelQueryDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Gambar wajib diunggah');
    }
    const safe = (file.originalname || 'upload.jpg')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .slice(-100);
    const filename = `${Date.now()}-${safe}`;
    return this.detectionsService.detectFromImage(user.sub, file.buffer, filename, file.mimetype, qm.model);
  }

  @Post('text')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Classify ingredient text' })
  async detectText(
    @CurrentUser() user: any,
    @Body() dto: DetectTextDto,
    @Query() qm: DetectModelQueryDto,
  ) {
    return this.detectionsService.detectFromText(user.sub, dto.text, qm.model);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List user detections' })
  findAll(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.detectionsService.findAllByUser(user.sub, pagination.page, pagination.limit);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detection detail' })
  findOne(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.detectionsService.findById(id, user?.sub, user?.role);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete detection' })
  remove(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.detectionsService.remove(id, user?.sub, user?.role);
  }
}
