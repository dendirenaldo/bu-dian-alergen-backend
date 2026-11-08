import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DatasetExportQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'verified'], description: 'Default hanya verified' })
  @IsOptional()
  @IsIn(['draft', 'verified'], { message: 'Status harus draft atau verified' })
  status?: 'draft' | 'verified';

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'Label harus safe atau unsafe' })
  label?: 'safe' | 'unsafe';

  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'], { message: 'Format harus csv atau json' })
  format?: 'csv' | 'json';
}

export class DatasetDownloadQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'verified'], description: 'Default hanya verified' })
  @IsOptional()
  @IsIn(['draft', 'verified'], { message: 'Status harus draft atau verified' })
  status?: 'draft' | 'verified';

  @ApiPropertyOptional({ enum: ['safe', 'unsafe'] })
  @IsOptional()
  @IsIn(['safe', 'unsafe'], { message: 'Label harus safe atau unsafe' })
  label?: 'safe' | 'unsafe';
}
