import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DetectTextDto {
  @ApiProperty({ example: 'Indomie Goreng ingredients: wheat flour, salt, sugar...' })
  @IsString({ message: 'Text must be a string' })
  @MinLength(1, { message: 'Text must not be empty' })
  @MaxLength(5000, { message: 'Text must not exceed 5000 characters' })
  text: string;
}
