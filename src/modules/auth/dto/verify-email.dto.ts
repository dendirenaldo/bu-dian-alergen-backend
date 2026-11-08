import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ example: 'a1b2c3...' })
  @IsString()
  @IsNotEmpty({ message: 'Token wajib diisi' })
  @MaxLength(256)
  token: string;
}
