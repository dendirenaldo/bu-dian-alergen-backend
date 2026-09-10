import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AllergensService } from './allergens.service';
import { CreateAllergenDto } from './dto/create-allergen.dto';
import { UpdateAllergenDto } from './dto/update-allergen.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('allergens')
@Controller('allergens')
export class AllergensController {
  constructor(private allergensService: AllergensService) {}

  @Get()
  @ApiOperation({ summary: 'List all allergens' })
  findAll() {
    return this.allergensService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get allergen by ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.allergensService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: 'Create allergen (admin)' })
  create(@Body() dto: CreateAllergenDto) {
    return this.allergensService.create(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: 'Update allergen (admin)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAllergenDto) {
    return this.allergensService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('admin')
  @ApiOperation({ summary: 'Delete allergen (admin)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.allergensService.remove(id);
  }
}
