import { IsString, IsEnum, IsOptional, IsBoolean, IsUrl, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AllergenSeverity } from '../../../common/enums/allergen.enum';

export class CreateAllergenDto {
  @ApiProperty({ example: 'Gluten' })
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @IsNotEmpty({ message: 'Nama wajib diisi' })
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'GLUTEN' })
  @Transform(({ value }) => String(value ?? '').trim().toUpperCase())
  @IsString()
  @IsNotEmpty({ message: 'Kode wajib diisi' })
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, { message: 'Kode hanya boleh huruf kapital, angka, underscore' })
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/icon.png' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  iconUrl?: string;

  @ApiPropertyOptional({ enum: AllergenSeverity, example: AllergenSeverity.High })
  @IsOptional()
  @IsEnum(AllergenSeverity)
  severityLevel?: AllergenSeverity;

  @ApiPropertyOptional({ example: '#ef4444' })
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Warna harus format hex (#RRGGBB)' })
  color?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
