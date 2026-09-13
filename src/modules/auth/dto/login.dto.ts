import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Password123' })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password wajib diisi' })
  @MaxLength(128)
  password: string;
}
