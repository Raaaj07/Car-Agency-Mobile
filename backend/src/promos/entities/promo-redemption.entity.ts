import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per completed ride that used a promo code (recorded atomically with
 * the completion inside the ride row lock). Feeds `promos.redemptionCount`
 * (maxRedemptions cap) and keeps an auditable history.
 *
 * `code` is denormalised and `promoId` is nullable (SET NULL on delete), so
 * deleting a promo from the admin console never destroys redemption history.
 */
@Entity('promo_redemptions')
@Index('IDX_promo_redemptions_promo', ['promoId'])
@Index('IDX_promo_redemptions_rider', ['riderId'])
export class PromoRedemptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  promoId: string | null = null;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'uuid' })
  rideId!: string;

  @Column({ type: 'uuid' })
  riderId!: string;

  @Column({ type: 'int' })
  discountAmount!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
