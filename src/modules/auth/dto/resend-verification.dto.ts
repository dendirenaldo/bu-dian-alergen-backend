import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ResendVerificationDto {
  @ApiProperty({ example: 'john@example.com' })
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  @MaxLength(255)
  email: string;
}
