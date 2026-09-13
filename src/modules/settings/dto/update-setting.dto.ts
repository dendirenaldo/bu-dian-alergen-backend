import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettingType } from '../../../common/enums/setting.enum';

export class UpdateSettingDto {
  @ApiProperty({ example: 'nama-aplikasi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  value: string;

  @ApiPropertyOptional({ enum: SettingType })
  @IsOptional()
  @IsEnum(SettingType)
  type?: SettingType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
