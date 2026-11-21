import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  ACQUISITION_SOURCES,
  DATASET_SOURCES,
  DATASET_STATUSES,
  OCR_STATUSES,
  QUALITY_STATUSES,
} from '../dataset.constants';

const STATUS_LIST_RE = new RegExp(`^(${DATASET_STATUSES.join('|')})(,${DATASET_STATUSES.join('|')})*$`);

function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  return undefined;
}

export class DatasetQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Satu atau beberapa status dipisah koma', example: 'draft,pending_review' })
  @IsOptional()
  @IsString()
  @Matches(STATUS_LIST_RE, { message: 'status tidak valid' })
  status?: string;

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'], description: 'Filter gold label' })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'Label harus safe atau unsafe' })
  label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ enum: DATASET_SOURCES })
  @IsOptional()
  @IsIn(DATASET_SOURCES as unknown as string[])
  source?: string;

  @ApiPropertyOptional({ enum: ACQUISITION_SOURCES })
  @IsOptional()
  @IsIn(ACQUISITION_SOURCES as unknown as string[])
  acquisitionSource?: string;

  @ApiPropertyOptional({ description: 'Filter kategori produk' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @ApiPropertyOptional({ description: 'Filter nama alergen pada anotasi' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  allergen?: string;

  @ApiPropertyOptional({ enum: OCR_STATUSES })
  @IsOptional()
  @IsIn(OCR_STATUSES as unknown as string[])
  ocrStatus?: string;

  @ApiPropertyOptional({ enum: QUALITY_STATUSES })
  @IsOptional()
  @IsIn(QUALITY_STATUSES as unknown as string[])
  quality?: string;

  @ApiPropertyOptional({ description: 'Hanya record duplikat (true) / non-duplikat (false)' })
  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean({ message: 'duplicate harus boolean' })
  duplicate?: boolean;

  @ApiPropertyOptional({ description: 'Hanya record yang eligible untuk ekspor' })
  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean({ message: 'exportEligible harus boolean' })
  exportEligible?: boolean;

  @ApiPropertyOptional({ description: 'Tanggal dibuat >= (ISO 8601)' })
  @IsOptional()
  @IsISO8601({}, { message: 'from harus tanggal ISO 8601' })
  from?: string;

  @ApiPropertyOptional({ description: 'Tanggal dibuat <= (ISO 8601)' })
  @IsOptional()
  @IsISO8601({}, { message: 'to harus tanggal ISO 8601' })
  to?: string;

  @ApiPropertyOptional({ description: 'Cari di corrected_text / ocr_text / nama produk / brand' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
