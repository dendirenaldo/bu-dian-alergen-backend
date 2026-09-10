import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Snacks' })
  @IsString({ message: 'Name must be a string' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Slug must be a string' })
  slug?: string;

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
  @IsInt({ message: 'Sort order must be an integer' })
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;
}
