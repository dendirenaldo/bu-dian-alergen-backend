import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DATASET_STATUSES,
  EXPORT_FORMATS,
  EXPORT_PROFILES,
  SPLIT_GROUPINGS,
  SPLIT_STRATEGIES,
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

/** Konfigurasi ekspor berprofil (ML-ready). */
export class CreateDatasetExportDto {
  @ApiPropertyOptional({ enum: EXPORT_PROFILES, default: 'nlp' })
  @IsOptional()
  @IsIn(EXPORT_PROFILES as unknown as string[], { message: 'profile tidak valid' })
  profile?: string;

  @ApiPropertyOptional({ enum: EXPORT_FORMATS, description: 'Default mengikuti profile' })
  @IsOptional()
  @IsIn(EXPORT_FORMATS as unknown as string[], { message: 'format tidak valid' })
  format?: string;

  @ApiPropertyOptional({ description: 'Status yang diikutkan (default verified,approved)', example: 'verified,approved' })
  @IsOptional()
  @IsString()
  @Matches(STATUS_LIST_RE, { message: 'status tidak valid' })
  status?: string;

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'label harus safe atau unsafe' })
  label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ description: 'Cari pada teks / produk' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Batasi ke ID tertentu' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsInt({ each: true })
  ids?: number[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  includeImages?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  includeSplits?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Sertakan berkas skema + checksums + README' })
  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  includeSchema?: boolean;

  @ApiPropertyOptional({ default: 42 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  seed?: number;

  @ApiPropertyOptional({ default: 0.7 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  trainRatio?: number;

  @ApiPropertyOptional({ default: 0.15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  validationRatio?: number;

  @ApiPropertyOptional({ default: 0.15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  testRatio?: number;

  @ApiPropertyOptional({ enum: SPLIT_GROUPINGS, default: 'detection' })
  @IsOptional()
  @IsIn(SPLIT_GROUPINGS as unknown as string[], { message: 'groupBy tidak valid' })
  groupBy?: string;

  @ApiPropertyOptional({ enum: SPLIT_STRATEGIES, default: 'multilabel' })
  @IsOptional()
  @IsIn(SPLIT_STRATEGIES as unknown as string[], { message: 'strategy tidak valid' })
  strategy?: string;

  @ApiPropertyOptional({ default: 5000, description: 'Batas aman jumlah record per ekspor' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20000)
  maxRecords?: number;
}
