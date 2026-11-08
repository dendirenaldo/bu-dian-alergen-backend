import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuditLog } from './models/audit-log.model';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLog)
    private readonly auditModel: typeof AuditLog,
  ) {}

  /**
   * Audit trail nyata (tabel audit_logs). Mode no-op terdokumentasi:
   * bila tabel/model belum termigrasi (fresh DB lama) atau write gagal,
   * hanya warn + return agar alur kurasi tidak terblokir.
   */
  async log(action: string, meta: Record<string, unknown> = {}): Promise<void> {
    try {
      const rawActor =
        (meta as any)?.actorId ?? (meta as any)?.adminId ?? (meta as any)?.actor_id ?? null;
      const actorId =
        rawActor === null || rawActor === undefined || Number.isNaN(Number(rawActor))
          ? null
          : Number(rawActor);
      await this.auditModel.create({
        action: String(action).slice(0, 64),
        actorId,
        meta: { ...meta, actorId },
      } as any);
    } catch (e) {
      this.logger.warn(`Audit log gagal (no-op): ${(e as any)?.message}`);
      return;
    }
  }
}
