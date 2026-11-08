import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  return undefined;
}

export class DatasetExportQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'verified'], description: 'Default hanya verified' })
  @IsOptional()
  @IsIn(['draft', 'verified'], { message: 'Status harus draft atau verified' })
  status?: 'draft' | 'verified';

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'Label harus safe atau unsafe' })
  label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'], { message: 'Format harus csv atau json' })
  format?: 'csv' | 'json';
}

export class DatasetDownloadQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'verified'], description: 'Default hanya verified' })
  @IsOptional()
  @IsIn(['draft', 'verified'], { message: 'Status harus draft atau verified' })
  status?: 'draft' | 'verified';

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'Label harus safe atau unsafe' })
  label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ description: 'Sertakan dataset.csv (default true)', default: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean({ message: 'includeLabels harus boolean' })
  includeLabels?: boolean;

  @ApiPropertyOptional({ description: 'Sertakan images/ (default true)', default: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean({ message: 'includeImages harus boolean' })
  includeImages?: boolean;

  @ApiPropertyOptional({ description: 'Sertakan split.json (default true)', default: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean({ message: 'includeSplit harus boolean' })
  includeSplit?: boolean;
}
