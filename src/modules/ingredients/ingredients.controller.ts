import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { IngredientsService } from './ingredients.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { BulkCreateIngredientDto } from './dto/bulk-create-ingredient.dto';

@ApiTags('ingredients')
@Controller()
export class IngredientsController {
  constructor(private ingredientsService: IngredientsService) {}

  @Get('products/:productId/ingredients')
  @ApiOperation({ summary: 'List ingredients by product' })
  @ApiParam({ name: 'productId', type: Number })
  findByProduct(@Param('productId', ParseIntPipe) productId: number) {
    return this.ingredientsService.findByProductId(productId);
  }

  @Post('ingredients')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Add ingredient (admin)' })
  create(@Body() dto: CreateIngredientDto) {
    return this.ingredientsService.create(dto);
  }

  @Post('ingredients/bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Bulk add ingredients (admin)' })
  bulk(@Body() dto: BulkCreateIngredientDto) {
    return this.ingredientsService.bulkCreate(dto.productId, dto.texts);
  }

  @Delete('ingredients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Delete ingredient (admin)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.ingredientsService.remove(id);
  }
}
