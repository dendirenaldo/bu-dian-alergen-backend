import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateIngredientDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @ApiProperty({ example: 'tepung terigu' })
  @IsString()
  @IsNotEmpty({ message: 'Teks bahan wajib diisi' })
  @MaxLength(5000)
  text: string;
}
