import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Every auditable admin action (A-12 / money decisions stay traceable). */
export type AuditAction =
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'reinstate'
  | 'ride_cancel'
  | 'payment_resolve'
  | 'payment_driver_confirm'
  // System: a signature-valid Razorpay webhook that did NOT match the stored
  // order (status/currency/amount). Nothing is settled; the row is for the
  // admin's reconciliation view.
  | 'payment_mismatch'
  // Pass-4 (task 6): soft trip-fraud flags (pickup_far / dropoff_far /
  // distance_inflated / location_jump) — never block a trip, just leave a
  // trace the admin ride detail surfaces as `flags[]`.
  | 'ride_flag'
  | 'upi_update'
  // Pass-4 (task 12): self-service compliance account deletion.
  | 'account_delete'
  // Task 12: Admin promo CRUD auditing
  | 'promo_create'
  | 'promo_update'
  | 'promo_delete'
  // Admin changed a runtime setting (driver search radius).
  | 'settings_update';

// Pass-4 (task 12): account deletion targets the USER row (targetId = userId);
// driver-specific effects are recorded in `meta.driverId`.
// Task 12: promo target type added for admin promo management audit trail.
export type AuditTargetType = 'driver' | 'ride' | 'user' | 'promo' | 'setting';

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
