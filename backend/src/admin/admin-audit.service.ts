import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { AdminAuditLogEntity, AuditAction, AuditTargetType } from './entities/admin-audit-log.entity';

export interface AuditEntry {
  actorUserId?: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  reason?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  reason: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Append-only audit trail for admin actions (A-12): `log()` is best-effort and
 * never throws — a failed audit write must not roll back the actual decision,
 * it is reported through the logger instead.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    @InjectRepository(AdminAuditLogEntity) private readonly logs: Repository<AdminAuditLogEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      let actorName: string | null = null;
      if (entry.actorUserId) {
        const actor = await this.users.findOne({ where: { id: entry.actorUserId } }).catch(() => null);
        actorName = actor?.name ?? null;
      }
      await this.logs.save(
        this.logs.create({
          actorUserId: entry.actorUserId ?? null,
          actorName,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          reason: entry.reason ?? null,
          meta: entry.meta ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Audit write failed (${entry.action} ${entry.targetType}:${entry.targetId}): ${(err as Error).message}`,
      );
    }
  }

  /** Paginated audit feed (GET /admin/audit). Newest first. */
  async list(
    page = 1,
    limit = 20,
    filters?: { action?: string; targetType?: string; targetId?: string; actorUserId?: string },
  ) {
    const lim = Math.min(Math.max(limit || 20, 1), 100); // A-16: clamp once, top
    const pg = Math.max(page || 1, 1);
    const qb = this.logs.createQueryBuilder('a');
    if (filters?.action) qb.andWhere('a.action = :action', { action: filters.action });
    if (filters?.targetType) qb.andWhere('a.targetType = :targetType', { targetType: filters.targetType });
    if (filters?.targetId) qb.andWhere('a.targetId = :targetId', { targetId: filters.targetId });
    if (filters?.actorUserId) qb.andWhere('a.actorUserId = :actorUserId', { actorUserId: filters.actorUserId });
    qb.orderBy('a.createdAt', 'DESC').addOrderBy('a.id', 'DESC').skip((pg - 1) * lim).take(lim);
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toAuditRow), total, page: pg, limit: lim };
  }

  /** Review history for one driver's detail screen (A-12: survives re-apply). */
  async historyForDriver(driverId: string, limit = 50): Promise<AuditRow[]> {
    const lim = Math.min(Math.max(limit || 50, 1), 100);
    const rows = await this.logs.find({
      where: { targetType: 'driver', targetId: driverId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: lim,
    });
    return rows.map(toAuditRow);
  }

  /** Newest entries for the overview "recent activity" feed. */
  async recent(limit = 10): Promise<AuditRow[]> {
    const rows = await this.logs.find({
      order: { createdAt: 'DESC', id: 'DESC' },
      take: Math.min(Math.max(limit || 10, 1), 50),
    });
    return rows.map(toAuditRow);
  }
}

function toAuditRow(r: AdminAuditLogEntity): AuditRow {
  return {
    id: r.id,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    meta: r.meta,
    createdAt: r.createdAt,
  };
}
