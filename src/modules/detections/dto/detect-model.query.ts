import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const DETECTION_MODELS = ['bilstm', 'bert', 'ensemble'] as const;
export type DetectionModelChoice = (typeof DETECTION_MODELS)[number];

export const DEFAULT_DETECTION_MODEL: DetectionModelChoice = 'bert';

export class DetectModelQueryDto {
  @ApiPropertyOptional({ enum: DETECTION_MODELS, default: DEFAULT_DETECTION_MODEL })
  @IsOptional()
  @Transform(({ value }) => String(value ?? DEFAULT_DETECTION_MODEL).toLowerCase().trim())
  @IsIn([...DETECTION_MODELS] as string[], { message: 'Model harus salah satu: bilstm, bert, ensemble' })
  model?: DetectionModelChoice = DEFAULT_DETECTION_MODEL;
}
