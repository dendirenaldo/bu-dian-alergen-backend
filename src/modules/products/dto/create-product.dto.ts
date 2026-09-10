import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Indomie Goreng' })
  @IsString({ message: 'Name must be a string' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Slug must be a string' })
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt({ message: 'Category ID must be an integer' })
  categoryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Brand must be a string' })
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Barcode must be a string' })
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Image URL must be a string' })
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;
}
