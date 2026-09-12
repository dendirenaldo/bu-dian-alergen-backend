import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContentsService } from './contents.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('contents')
@Controller('contents')
export class ContentsController {
  constructor(private contentsService: ContentsService) {}

  @Get()
  @ApiOperation({ summary: 'List contents' })
  findAll(@Query('type') type?: string, @Query('status') status?: string) {
    return this.contentsService.findAll(type, status);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get content by slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.contentsService.findBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Create content (admin)' })
  create(@Body() dto: CreateContentDto, @CurrentUser() user: any) {
    return this.contentsService.create(dto, user.sub);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Update content (admin)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContentDto) {
    return this.contentsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Delete content (admin)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.contentsService.remove(id);
  }
}
