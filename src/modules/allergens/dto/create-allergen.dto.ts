import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAllergenDto {
  @ApiProperty({ example: 'Gluten' })
  @IsString({ message: 'Name must be a string' })
  name: string;

  @ApiProperty({ example: 'GLUTEN' })
  @IsString({ message: 'Code must be a string' })
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Icon URL must be a string' })
  iconUrl?: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional()
  @IsEnum(['low', 'medium', 'high', 'critical'], { message: 'Severity level must be low, medium, high, or critical' })
  severityLevel?: string;

  @ApiPropertyOptional({ example: '#ef4444' })
  @IsOptional()
  @IsString({ message: 'Color must be a string' })
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;
}
