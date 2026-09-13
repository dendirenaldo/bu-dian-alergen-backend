import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'indomie' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
