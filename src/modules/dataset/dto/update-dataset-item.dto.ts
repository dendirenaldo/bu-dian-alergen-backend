import {
  IsArray,
  IsIn,
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
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CorrectedAllergenDto {
  @ApiPropertyOptional({ example: 'Gluten' })
  @IsString({ message: 'Nama alergen harus string' })
  name: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
  @IsIn(['low', 'medium', 'high', 'critical'], { message: 'Severity harus low, medium, high, atau critical' })
  severity: 'low' | 'medium' | 'high' | 'critical';

  @ApiPropertyOptional({ example: 0.95, minimum: 0, maximum: 1 })
  @IsNumber({}, { message: 'Confidence harus angka 0..1' })
  @Min(0, { message: 'Confidence minimal 0' })
  @Max(1, { message: 'Confidence maksimal 1' })
  confidence: number;
}

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
  @ValidateNested({ each: true })
  @Type(() => CorrectedAllergenDto)
  corrected_allergens?: CorrectedAllergenDto[];

  @ApiPropertyOptional({ enum: ['draft', 'verified'] })
  @IsOptional()
  @IsIn(['draft', 'verified'], { message: 'status harus draft atau verified' })
  status?: 'draft' | 'verified';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'notes harus string' })
  notes?: string;
}
