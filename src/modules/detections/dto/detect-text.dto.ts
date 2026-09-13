import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class DetectTextDto {
  @ApiProperty({ example: 'Indomie Goreng ingredients: wheat flour, salt, sugar...' })
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'Text must be a string' })
  @IsNotEmpty({ message: 'Teks wajib diisi' })
  @MinLength(1, { message: 'Text must not be empty' })
  @MaxLength(5000, { message: 'Text must not exceed 5000 characters' })
  text: string;
}
