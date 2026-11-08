import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class DatasetQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'verified'] })
  @IsOptional()
  @IsIn(['draft', 'verified'], { message: 'Status harus draft atau verified' })
  status?: 'draft' | 'verified';

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'], description: 'Filter gold label' })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'Label harus safe atau unsafe' })
  label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ description: 'Cari di corrected_text / ocr_text' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
