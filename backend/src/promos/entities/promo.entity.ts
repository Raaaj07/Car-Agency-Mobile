import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * PR-1 (Task 8): promo codes live in Postgres instead of the old hard-coded
 * PROMOS_CONFIG array — admin CRUD, validity windows and redemption caps.
 */
@Entity('promos')
@Index('IDX_promos_code', ['code'], { unique: true })
export class PromoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Stored uppercased; the rider endpoints and admin CRUD both normalise input.
  @Column({ type: 'varchar', length: 30 })
  code!: string;

  // Rider-card copy. Null → the service composes a default from the discount.
  @Column({ type: 'varchar', length: 140, nullable: true })
  title: string | null = null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subtitle: string | null = null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  cta: string | null = null;

  @Column({ type: 'int' })
  discountAmount!: number;

  // First completed ride only (was the fixed VAZHI20 behaviour).
  @Column({ type: 'boolean', default: false })
  firstRideOnly!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  // Optional validity window (null = open-ended).
  @Column({ type: 'timestamptz', nullable: true })
  validFrom: Date | null = null;

  @Column({ type: 'timestamptz', nullable: true })
  validTo: Date | null = null;

  // Optional cap; counted by promo_redemptions rows (recorded at ride completion).
  @Column({ type: 'int', nullable: true })
  maxRedemptions: number | null = null;

  @Column({ type: 'int', default: 0 })
  redemptionCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
