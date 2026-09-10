import { PartialType } from '@nestjs/swagger';
import { CreateAllergenDto } from './create-allergen.dto';

export class UpdateAllergenDto extends PartialType(CreateAllergenDto) {}
