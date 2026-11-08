import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler tahan proxy/NAT: sidik = IP klien (XFF pertama) + User-Agent.
 * Guard default hanya memakai req.ip → semua user di balik 1 proxy/NAT
 * berbagi 1 bucket dan kena 429 massal. Pola: bpu-unsri-api.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  private readonly logger = new Logger(ThrottlerBehindProxyGuard.name);

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwarded = req.headers?.['x-forwarded-for'];
    const clientIp = forwarded
      ? (Array.isArray(forwarded) ? forwarded[0] : String(forwarded).split(',')[0]).trim()
      : req.ip;
    const ua = req.headers?.['user-agent'] || 'unknown';
    const fingerprint = `${clientIp}:${String(ua).substring(0, 64)}`;
    if (process.env.THROTTLE_DEBUG === 'true') {
      this.logger.debug(`[Throttler] ${req.method} ${req.url} -> ${fingerprint}`);
    }
    return fingerprint;
  }
}
