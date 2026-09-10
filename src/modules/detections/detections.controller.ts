import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UploadedFile, UseInterceptors, ParseIntPipe } from '@nestjs/common';
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
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload image for allergen detection' })
  async upload(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.detectionsService.detectFromImage(user.sub, file.buffer, file.originalname);
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
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.detectionsService.findById(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete detection' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.detectionsService.remove(id);
  }
}
