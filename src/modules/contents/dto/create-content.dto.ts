import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContentDto {
  @ApiProperty()
  @IsString({ message: 'Title must be a string' })
  title: string;

  @ApiProperty()
  @IsString({ message: 'Slug must be a string' })
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Body must be a string' })
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Excerpt must be a string' })
  excerpt?: string;

  @ApiPropertyOptional({ enum: ['page', 'article', 'announcement'] })
  @IsOptional()
  @IsEnum(['page', 'article', 'announcement'], { message: 'Type must be page, article, or announcement' })
  type?: string;

  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @IsOptional()
  @IsEnum(['draft', 'published', 'archived'], { message: 'Status must be draft, published, or archived' })
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Featured image URL must be a string' })
  featuredImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Meta title must be a string' })
  metaTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Meta description must be a string' })
  metaDescription?: string;
}
