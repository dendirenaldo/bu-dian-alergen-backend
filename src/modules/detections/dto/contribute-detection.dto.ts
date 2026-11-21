import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AllergenAnnotationDto } from '../../dataset/dto/create-dataset-item.dto';

/**
 * Kontribusi pengguna atas hasil deteksi miliknya. Semua field opsional —
 * pengguna tidak dipaksa mengoreksi bila tidak yakin; admin tetap meninjau.
 */
export class ContributeDetectionDto {
  @ApiPropertyOptional({ description: 'Koreksi teks label oleh pengguna (maks 5000)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Teks koreksi maksimal 5000 karakter' })
  corrected_text?: string;

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'gold_label harus safe atau unsafe' })
  gold_label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ type: [AllergenAnnotationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllergenAnnotationDto)
  corrected_allergens?: AllergenAnnotationDto[];

  @ApiPropertyOptional({ description: 'Catatan untuk admin (maks 1000)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Catatan maksimal 1000 karakter' })
  notes?: string;
}
