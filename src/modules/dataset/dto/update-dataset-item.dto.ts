import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AllergenAnnotationDto } from './create-dataset-item.dto';
import {
  DATASET_STATUSES,
  IMAGE_TYPES,
  OCR_STATUSES,
} from '../dataset.constants';

/**
 * Kompatibel dengan payload lama (`corrected_text`, `gold_label`,
 * `corrected_allergens`, `status`, `notes`) sekaligus menerima metadata
 * platform yang baru. Semua field opsional (PATCH parsial).
 */
export class CorrectedAllergenDto extends AllergenAnnotationDto {}

export class UpdateDatasetItemDto {
  @ApiPropertyOptional({ description: 'Teks koreksi manual (1..5000 karakter)' })
  @IsOptional()
  @IsString({ message: 'corrected_text harus string' })
  @MinLength(1, { message: 'corrected_text minimal 1 karakter' })
  @MaxLength(5000, { message: 'corrected_text maksimal 5000 karakter' })
  corrected_text?: string;

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'gold_label harus safe atau unsafe' })
  gold_label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ type: [CorrectedAllergenDto] })
  @IsOptional()
  @IsArray({ message: 'corrected_allergens harus array' })
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => CorrectedAllergenDto)
  corrected_allergens?: CorrectedAllergenDto[];

  @ApiPropertyOptional({ enum: DATASET_STATUSES })
  @IsOptional()
  @IsIn(DATASET_STATUSES as unknown as string[], { message: 'status tidak valid' })
  status?: string;

  @ApiPropertyOptional({ description: 'Catatan kurasi (maks 2000 karakter)' })
  @IsOptional()
  @IsString({ message: 'notes harus string' })
  @MaxLength(2000, { message: 'notes maksimal 2000 karakter' })
  notes?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) product_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) barcode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) ocr_text?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) ingredient_text?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  normalized_ingredients?: string[];

  @ApiPropertyOptional({ enum: IMAGE_TYPES })
  @IsOptional()
  @IsIn(IMAGE_TYPES as unknown as string[])
  image_type?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) ocr_engine?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) ocr_engine_version?: string;

  @ApiPropertyOptional({ enum: OCR_STATUSES })
  @IsOptional()
  @IsIn(OCR_STATUSES as unknown as string[])
  ocr_status?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() export_eligible?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) review_note?: string;

  @ApiPropertyOptional({ description: 'updatedAt yang dilihat klien (optimistic concurrency)' })
  @IsOptional()
  @IsISO8601({}, { message: 'expected_updated_at harus ISO 8601' })
  expected_updated_at?: string;
}
