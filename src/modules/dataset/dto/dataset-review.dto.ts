import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const REVIEW_ACTIONS = [
  'submit',
  'approve',
  'verify',
  'reject',
  'request_correction',
  'unverify',
  'archive',
  'restore',
] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Aksi workflow review admin. Backend memetakan aksi → transisi status. */
export class DatasetReviewDto {
  @ApiProperty({ enum: REVIEW_ACTIONS })
  @IsIn(REVIEW_ACTIONS as unknown as string[], { message: 'action review tidak valid' })
  action: ReviewAction;

  @ApiPropertyOptional({ description: 'Catatan reviewer (wajib untuk reject/request_correction)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Catatan review maksimal 2000 karakter' })
  note?: string;
}
