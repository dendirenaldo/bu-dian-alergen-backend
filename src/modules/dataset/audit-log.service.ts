import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
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
  /** Riwayat aksi untuk satu record dataset (dibaca dari audit_logs). */
  async history(datasetId: number, limit = 50) {
    try {
      // Filter JSON di SQL tidak portabel (MariaDB vs SQLite). Ambil jendela
      // audit terbaru yang relevan lalu saring di memori; jumlahnya dibatasi.
      const rows: any[] = await this.auditModel.findAll({
        where: { action: { [Op.like]: 'dataset.%' } },
        order: [['id', 'DESC']],
        limit: 1000,
      });
      const wanted = Number(datasetId);
      const filtered = rows.filter((r) => {
        const meta: any = r.meta ?? r.get?.('meta') ?? {};
        return Number(meta?.datasetId) === wanted || Number(meta?.dataset_id) === wanted;
      });
      return filtered.slice(0, Math.min(Math.max(limit, 1), 200)).map((r) => ({
        id: r.id,
        action: r.action,
        actorId: r.actorId ?? r.actor_id ?? null,
        meta: r.meta ?? null,
        createdAt: r.createdAt ?? r.created_at,
      }));
    } catch {
      return [];
    }
  }

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
