import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam } from '@nestjs/swagger';
import { AllergensService } from './allergens.service';
import { CreateAllergenDto } from './dto/create-allergen.dto';
import { UpdateAllergenDto } from './dto/update-allergen.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('allergens')
@Controller('allergens')
export class AllergensController {
  constructor(private allergensService: AllergensService) {}

  @Get()
  @ApiOperation({ summary: 'List all allergens' })
  @ApiResponse({ status: 200, description: 'Allergens retrieved successfully' })
  findAll() {
    return this.allergensService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get allergen by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Allergen retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Allergen not found' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.allergensService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Create allergen (admin)' })
  @ApiResponse({ status: 201, description: 'Allergen created successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateAllergenDto) {
    return this.allergensService.create(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Update allergen (admin)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Allergen updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Allergen not found' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAllergenDto) {
    return this.allergensService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Delete allergen (admin)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Allergen deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Allergen not found' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.allergensService.remove(id);
  }
}
