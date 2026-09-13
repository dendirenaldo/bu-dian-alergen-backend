import { IsString, IsEmail, MinLength, MaxLength, Matches, IsOptional, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Nama wajib diisi' })
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Password123' })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password wajib diisi' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Z])(?=.*\d)/, { message: 'Password must contain uppercase letter and number' })
  password: string;

  @ApiPropertyOptional({ example: '08123456789' })
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @IsString({ message: 'Phone must be a string' })
  @MaxLength(20)
  @Matches(/^(\+62|62|0)[0-9]{8,14}$/, { message: 'Format nomor telepon tidak valid' })
  phone?: string;
}
