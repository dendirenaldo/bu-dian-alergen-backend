import { Controller, Get, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(Role.Admin)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics (admin)' })
  getStats() {
    return this.dashboardService.getStats();
  }

  @Get('recent')
  @ApiOperation({ summary: 'Get recent detections (admin)' })
  getRecent(@Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number) {
    const safe = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 10;
    return this.dashboardService.getRecentDetections(safe);
  }

  @Get('trend')
  @ApiOperation({ summary: 'Get daily detection trend (admin)' })
  getTrend(@Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number) {
    return this.dashboardService.getTrend(days);
  }
}
