import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ACQUISITION_SOURCES,
  ALLERGEN_PRESENCE,
  ALLERGEN_SEVERITIES,
  ANNOTATION_SOURCES,
  DATASET_SOURCES,
  IMAGE_TYPES,
  OCR_STATUSES,
} from '../dataset.constants';

export class AllergenAnnotationDto {
  @ApiProperty({ example: 'Gluten' })
  @IsString({ message: 'Nama alergen harus string' })
  @MinLength(1, { message: 'Nama alergen wajib diisi' })
  @MaxLength(120, { message: 'Nama alergen maksimal 120 karakter' })
  name: string;

  @ApiPropertyOptional({ enum: ALLERGEN_SEVERITIES })
  @IsOptional()
  @IsIn(ALLERGEN_SEVERITIES as unknown as string[], {
    message: 'Severity harus low, medium, high, atau critical',
  })
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @ApiPropertyOptional({ example: 0.95, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber({}, { message: 'Confidence harus angka 0..1' })
  @Min(0, { message: 'Confidence minimal 0' })
  @Max(1, { message: 'Confidence maksimal 1' })
  confidence?: number;

  @ApiPropertyOptional({ enum: ALLERGEN_PRESENCE })
  @IsOptional()
  @IsIn(ALLERGEN_PRESENCE as unknown as string[], { message: 'Presence alergen tidak valid' })
  presence?: 'present' | 'absent' | 'unknown' | 'may_contain' | 'cross_contamination' | 'not_stated' | 'not_evaluated';

  @ApiPropertyOptional({ description: 'Kutipan label sebagai bukti (maks 500 karakter)' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Evidence maksimal 500 karakter' })
  evidence?: string;
}

/** Payload pembuatan record dataset manual oleh admin. */
export class CreateDatasetItemDto {
  @ApiPropertyOptional({ description: 'Nama produk (wajib untuk submit review, boleh kosong saat draft)' })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Nama produk maksimal 255 karakter' })
  product_name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) barcode?: string;

  @ApiPropertyOptional({ description: 'Teks mentah OCR / label (maks 5000)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Teks OCR maksimal 5000 karakter' })
  ocr_text?: string;

  @ApiPropertyOptional({ description: 'Transkripsi hasil koreksi manusia' })
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Teks koreksi maksimal 5000 karakter' })
  corrected_text?: string;

  @ApiPropertyOptional({ description: 'Teks komposisi/ingredien asli' })
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Teks ingredien maksimal 5000 karakter' })
  ingredient_text?: string;

  @ApiPropertyOptional({ type: [String], description: 'Daftar ingredien terstruktur (urutan dipertahankan)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300, { message: 'Maksimal 300 ingredien' })
  @IsString({ each: true })
  normalized_ingredients?: string[];

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'gold_label harus safe atau unsafe' })
  gold_label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ type: [AllergenAnnotationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AllergenAnnotationDto)
  corrected_allergens?: AllergenAnnotationDto[];

  @ApiPropertyOptional({ enum: ['draft', 'pending_review', 'verified'] })
  @IsOptional()
  @IsIn(['draft', 'pending_review', 'verified'], { message: 'status awal tidak valid' })
  status?: 'draft' | 'pending_review' | 'verified';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @ApiPropertyOptional({ enum: DATASET_SOURCES })
  @IsOptional()
  @IsIn(DATASET_SOURCES as unknown as string[])
  source?: 'detection' | 'manual' | 'import' | 'user_submission';

  @ApiPropertyOptional({ enum: ACQUISITION_SOURCES })
  @IsOptional()
  @IsIn(ACQUISITION_SOURCES as unknown as string[])
  acquisition_source?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) acquisition_context?: string;

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

  @ApiPropertyOptional({ enum: ANNOTATION_SOURCES })
  @IsOptional()
  @IsIn(ANNOTATION_SOURCES as unknown as string[])
  annotation_source?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) annotation_version?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) annotation_schema_version?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) source_app_version?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  export_eligible?: boolean;

  @ApiPropertyOptional({ description: 'Simpan sebagai draf tanpa validasi kelengkapan' })
  @IsOptional()
  @IsBoolean()
  allow_incomplete?: boolean;

  @ApiPropertyOptional({ description: 'Deteksi sumber, bila record ditautkan ke deteksi yang ada' })
  @IsOptional()
  @IsInt()
  @Min(1)
  detection_id?: number;
}
