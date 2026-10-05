import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Every auditable admin action (A-12 / money decisions stay traceable). */
export type AuditAction =
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'reinstate'
  | 'ride_cancel'
  | 'payment_resolve'
  | 'upi_update';

export type AuditTargetType = 'driver' | 'ride';

@Entity('admin_audit_logs')
@Index(['targetType', 'targetId'])
@Index(['createdAt'])
export class AdminAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Null only for system actors (none today) — kept nullable for safety.
  @Column({ type: 'varchar', length: 36, nullable: true })
  actorUserId: string | null = null;

  // Snapshot of the actor's name at action time; survives user deletion.
  @Column({ type: 'varchar', length: 120, nullable: true })
  actorName: string | null = null;

  @Column({ type: 'varchar', length: 40 })
  action!: AuditAction;

  // Application rows ARE driver rows (same id), so driver review history is
  // one lookup: targetType='driver', targetId=<driverId>.
  @Column({ type: 'varchar', length: 20 })
  targetType!: AuditTargetType;

  @Column({ type: 'varchar', length: 36 })
  targetId!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null = null;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null = null;

  @CreateDateColumn()
  createdAt!: Date;
}
