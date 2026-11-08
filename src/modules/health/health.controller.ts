import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Health check (tanpa auth, tanpa throttle — untuk monitor/uptime)' })
  check() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
