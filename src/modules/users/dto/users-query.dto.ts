import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class UsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Filter verified: true|false' })
  @IsOptional()
  @IsIn(['true', 'false'])
  verified?: string;
}
