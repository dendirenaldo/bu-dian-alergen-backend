import { Controller, Get, Post, Put, Delete, Body, Param, Query, Headers, UseGuards, UploadedFile, UseInterceptors, ParseIntPipe, BadRequestException, Req, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { DetectionsService, FREE_DETECTION_LIMIT, buildSseEvent, encodeSse, ensureAnonId, extractClientIp, hashIp, SSE_HEARTBEAT, SSE_HEARTBEAT_MS } from './detections.service';
import { DatasetService } from '../dataset/dataset.service';
import { DetectTextDto } from './dto/detect-text.dto';
import { DetectModelQueryDto } from './dto/detect-model.query';
import { AdminDetectionsQueryDto } from './dto/admin-detections.query';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

function setAnonCookie(req: Request, res: Response, anonId: string) {
  const existing = (req as any)?.cookies?.['anon_id'];
  if (existing === anonId) return;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
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
  constructor(
    private detectionsService: DetectionsService,
    private datasetService: DatasetService,
  ) {}


  @Get('public/quota')
  @Public()
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

  @Post('public/text')
  @Public()
  @Throttle({ public: { limit: 6, ttl: 3600000 } })
  @ApiOperation({ summary: 'Deteksi teks tanpa login (hanya bisa 5x per jam)' })
  async publicDetectText(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: DetectTextDto,
    @Query() qm: DetectModelQueryDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const anonId = ensureAnonId(req);
    setAnonCookie(req, res, anonId);
    const ipHash = hashIp(extractClientIp(req));
    const uploadId = this.detectionsService.newJobId();
    res.setHeader('X-Job-Id', uploadId);
    this.detectionsService.createJob(uploadId, {
      kind: 'text',
      ipHash,
      anonId,
      idempotencyKey: idempotencyKey?.trim() || null,
    });
    let completed = false;
    const onClose = () => {
      if (!completed && !res.writableEnded) {
        void this.detectionsService.refundJobQuota(uploadId).catch(() => undefined);
      }
    };
    req.on('close', onClose);
    try {
      const { detection, remaining } = await this.detectionsService.detectPublicFromText({
        text: dto.text,
        modelInput: qm.model,
        ipHash,
        anonId,
        idempotencyKey: idempotencyKey?.trim() || null,
        uploadId,
      });
      completed = true;
      publicRateHeaders(res, remaining);
      const job = this.detectionsService.getJob(uploadId);
      if (job?.fallbackNotice) res.setHeader('X-Model-Fallback', 'bilstm');
      return detection;
    } finally {
      req.removeListener('close', onClose);
    }
  }

  @Post('public/upload')
  @Public()
  @Throttle({ public: { limit: 6, ttl: 3600000 } })
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Deteksi gambar tanpa login (hanya bisa 5x per jam)' })
  async publicUpload(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UploadedFile() file: Express.Multer.File,
    @Query() qm: DetectModelQueryDto,
    @Headers('idempotency-key') idempotencyKey?: string,
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
    const uploadId = this.detectionsService.newJobId();
    res.setHeader('X-Job-Id', uploadId);
    this.detectionsService.createJob(uploadId, {
      kind: 'image',
      ipHash,
      anonId,
      idempotencyKey: idempotencyKey?.trim() || null,
    });
    let completed = false;
    const onClose = () => {
      if (!completed && !res.writableEnded) {
        void this.detectionsService.refundJobQuota(uploadId).catch(() => undefined);
      }
    };
    req.on('close', onClose);
    try {
      const { detection, remaining } = await this.detectionsService.detectPublicFromImage({
        buffer: file.buffer,
        filename,
        mimetype: file.mimetype,
        modelInput: qm.model,
        ipHash,
        anonId,
        idempotencyKey: idempotencyKey?.trim() || null,
        uploadId,
      });
      completed = true;
      publicRateHeaders(res, remaining);
      const job = this.detectionsService.getJob(uploadId);
      if (job?.fallbackNotice) res.setHeader('X-Model-Fallback', 'bilstm');
      return detection;
    } finally {
      req.removeListener('close', onClose);
    }
  }


  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: semua riwayat deteksi beserta pemiliknya' })
  findAllAdmin(@Query() query: AdminDetectionsQueryDto) {
    return this.detectionsService.findAllAdmin(query);
  }

  @Put('admin/dataset/:detectionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: upsert dataset item dari deteksi (prefill ocr/gold label/alergen)' })
  upsertDataset(@Param('detectionId', ParseIntPipe) detectionId: number, @CurrentUser() user: any) {
    return this.datasetService.upsertFromDetection(detectionId, user?.sub);
  }


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
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Gambar wajib diunggah');
    }
    const safe = (file.originalname || 'upload.jpg')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .slice(-100);
    const filename = `${Date.now()}-${safe}`;
    const uploadId = this.detectionsService.newJobId();
    res.setHeader('X-Job-Id', uploadId);
    this.detectionsService.createJob(uploadId, {
      kind: 'image',
      userId: user.sub,
      idempotencyKey: idempotencyKey?.trim() || null,
    });
    const detection = await this.detectionsService.detectFromImage(
      user.sub,
      file.buffer,
      filename,
      file.mimetype,
      qm.model,
      { idempotencyKey: idempotencyKey?.trim() || null, uploadId },
    );
    const job = this.detectionsService.getJob(uploadId);
    if (job?.fallbackNotice) res.setHeader('X-Model-Fallback', 'bilstm');
    return detection;
  }

  @Post('text')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Classify ingredient text' })
  async detectText(
    @CurrentUser() user: any,
    @Body() dto: DetectTextDto,
    @Query() qm: DetectModelQueryDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const uploadId = this.detectionsService.newJobId();
    res.setHeader('X-Job-Id', uploadId);
    this.detectionsService.createJob(uploadId, {
      kind: 'text',
      userId: user.sub,
      idempotencyKey: idempotencyKey?.trim() || null,
    });
    const detection = await this.detectionsService.detectFromText(user.sub, dto.text, qm.model, {
      idempotencyKey: idempotencyKey?.trim() || null,
      uploadId,
    });
    const job = this.detectionsService.getJob(uploadId);
    if (job?.fallbackNotice) res.setHeader('X-Model-Fallback', 'bilstm');
    return detection;
  }

  @Get('stream')
  @Public()
  @ApiOperation({ summary: 'SSE progres deteksi (kontrak Fase 1) via uploadId' })
  async stream(
    @Query('uploadId') uploadId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!uploadId?.trim()) {
      throw new BadRequestException('uploadId wajib diisi');
    }
    const id = uploadId.trim();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

    let closed = false;
    const heartbeat = setInterval(() => {
      if (!closed) {
        try {
          res.write(SSE_HEARTBEAT);
        } catch {
          closed = true;
        }
      }
    }, SSE_HEARTBEAT_MS);
    const cleanup = () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* abaikan */
        }
      }
    };
    req.on('close', () => {
      closed = true;
      const job = this.detectionsService.getJob(id);
      if (job && job.status !== 'done' && !job.refunded) {
        void this.detectionsService.refundJobQuota(id).catch(() => undefined);
      }
      cleanup();
    });

    const send = (stage: string, progress: number, message: string, data?: any, etaMs?: number) => {
      res.write(encodeSse(buildSseEvent(stage, progress, message, data, etaMs)));
    };

    const job = this.detectionsService.getJob(id);
    if (!job) {
      send('error', 0, 'Job tidak ditemukan atau sudah kedaluwarsa', { uploadId: id });
      cleanup();
      return;
    }

    // Tunggu job selesai bila stream dibuka sebelum POST selesai (maks 120 dtk).
    const deadline = Date.now() + 120000;
    let current = job;
    while (
      !closed &&
      current.status !== 'done' &&
      current.status !== 'error' &&
      current.status !== 'cancelled' &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 250));
      current = this.detectionsService.getJob(id) ?? current;
    }
    if (closed) return;
    if (current.status !== 'done') {
      if (current.status === 'cancelled' || current.cancelled) {
        send('error', 0, 'Job dibatalkan', { uploadId: id });
      } else if (current.status === 'error') {
        send('error', 100, current.error || 'Deteksi gagal', { uploadId: id });
      } else {
        send('error', 0, 'Menunggu hasil deteksi habis waktu', { uploadId: id });
      }
      cleanup();
      return;
    }

    const events = await this.detectionsService.buildJobReplay(id);
    for (const ev of events) {
      if (closed) break;
      res.write(encodeSse(ev));
    }
    cleanup();
  }

  @Delete('job/:id')
  @Public()
  @ApiOperation({ summary: 'Batalkan job SSE + refund kuota' })
  async cancelJob(@Param('id') id: string) {
    if (!id?.trim()) throw new BadRequestException('Job id wajib diisi');
    const result = await this.detectionsService.cancelJob(id.trim());
    return { uploadId: id.trim(), ...result };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List user detections' })
  findAll(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.detectionsService.findAllByUser(user.sub, pagination.page, pagination.limit, pagination);
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
