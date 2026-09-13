import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty()
  @Expose()
  id: number;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiProperty()
  @Expose()
  email: string;

  @ApiPropertyOptional()
  @Expose()
  phone?: string;

  @ApiPropertyOptional()
  @Expose()
  avatarUrl?: string;

  @ApiProperty({ enum: ['admin', 'user'] })
  @Expose()
  role: string;

  @ApiPropertyOptional()
  @Expose()
  isActive?: boolean;

  @ApiPropertyOptional()
  @Expose()
  @Type(() => Date)
  lastLoginAt?: Date;

  @ApiProperty()
  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @ApiPropertyOptional()
  @Expose()
  @Type(() => Date)
  updatedAt?: Date;

  @Exclude()
  password: string;
}
