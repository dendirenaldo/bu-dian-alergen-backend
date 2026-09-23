import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AdminDetectionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter user id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'Result harus safe atau unsafe' })
  result?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ description: 'Cari di ocr_text / nama user / email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
