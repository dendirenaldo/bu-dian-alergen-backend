import { IsString, IsOptional, IsInt, IsBoolean, IsNotEmpty, MaxLength, Min, Matches } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Indomie Goreng' })
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @IsNotEmpty({ message: 'Nama produk wajib diisi' })
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: 'indomie-goreng' })
  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? value : String(value).trim().toLowerCase()))
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug hanya boleh huruf kecil, angka, dan strip' })
  slug?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ example: 'Indofood' })
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @IsString()
  @MaxLength(255)
  brand?: string;

  @ApiPropertyOptional({ example: '089686010013' })
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @IsString()
  @MaxLength(50)
  @Matches(/^[0-9]+$/, { message: 'Barcode hanya boleh angka' })
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/produk.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: ['tepung terigu', 'garam'], type: [String] })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  @IsString({ each: true })
  ingredients?: string[];
}
