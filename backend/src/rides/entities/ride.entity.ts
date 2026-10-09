import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { DriverEntity, VehicleType } from '../../drivers/entities/driver.entity';
import { FareBreakdown } from '../../common/frontend-contracts';

// Every state the frontend screens represent, in order:
// requested (FindingDriver) -> matched (YouGotTheRide) ->
// driver_en_route (DriverEnRoute) -> in_progress (TripProgress) ->
// completed (RideCompleted / PaymentFareBreakdown) | cancelled (RideCancelled)
export type RideStatus =
  | 'requested'
  | 'matched'
  | 'driver_en_route'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type PaymentMethod = 'upi' | 'wallet' | 'card' | 'cash';
// State machine (P-1): pending → rider_claimed → paid | disputed, plus
// 'failed' for a failed Razorpay verification. Only the driver/admin/provider
// paths may reach 'paid' — a rider claim alone never settles the ride.
export type PaymentStatus = 'pending' | 'rider_claimed' | 'paid' | 'disputed' | 'failed';
export type PaymentMarkedBy = 'rider' | 'driver' | 'admin' | 'provider';

export interface RideLocation {
  address: string;
  lat: number;
  lng: number;
}

// SEC-4: at most ONE active ride per rider, enforced by the database. The
// count() pre-check in RidesService.create() is only a friendly fast path —
// two concurrent POST /rides both saw zero and double-booked (two active
// rides, two driver searches). Partial index: completed/cancelled history
// rows are unaffected. Declared here with the SAME name/shape as migration
// 1791600000000 so DB_SYNCHRONIZE keeps it (TypeORM drops indexes the
// entity does not know) and can even create it on a synchronize-only DB.
@Index('UQ_rides_active_per_rider', ['riderId'], {
  unique: true,
  where: `"status" IN ('requested','matched','driver_en_route','in_progress')`,
})
@Entity('rides')
export class RideEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  riderId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'riderId' })
  rider!: UserEntity;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  driverId?: string | null;

  @ManyToOne(() => DriverEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'driverId' })
  driver?: DriverEntity | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'requested' })
  status!: RideStatus;

  @Column({ type: 'varchar', length: 10 })
  vehicleType!: VehicleType;

  @Column({ type: 'jsonb' })
  pickup!: RideLocation;

  @Column({ type: 'jsonb' })
  dropoff!: RideLocation;

  @Column({ type: 'varchar', length: 20, nullable: true })
  promoCode?: string | null;

  // Matches FareBreakdown exactly; recalculated on /complete with the
  // final distance/time, so early screens see an estimate and
  // PaymentFareBreakdownScreen sees the settled amount.
  @Column({ type: 'jsonb' })
  fareBreakdown!: FareBreakdown;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  distanceKm?: string | null;

  // 4-digit code shown on YouGotTheRideScreen, checked on Trip start.
  @Column({ type: 'varchar', length: 4, nullable: true })
  pickupOtp?: string | null;

  // Matches the exact reason list on CancelRideConfirmationScreen (+ 'other').
  @Column({ type: 'varchar', length: 200, nullable: true })
  cancellationReason?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  cancelledBy?: 'rider' | 'driver' | 'system' | 'admin' | null;

  @Column({ type: 'varchar', length: 10, default: 'upi' })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  paymentStatus!: PaymentStatus;

  // Who last moved paymentStatus to a settled state (P-1):
  // rider=claimed in app, driver="Amount Received", admin=console resolution,
  // provider=Razorpay signature verification.
  @Column({ type: 'varchar', length: 16, nullable: true })
  paymentMarkedBy?: PaymentMarkedBy | null;

  // Set by ReviewRideScreen.
  @Column({ type: 'smallint', nullable: true })
  rating?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  compliments?: string[] | null;

  @Column({ type: 'int', default: 0 })
  tipAmount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  matchedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  offeredAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  offerExpiresAt?: Date | null;

  @Column({ type: 'text', array: true, default: '{}' })
  declinedDriverIds!: string[];

  @Column({ type: 'int', default: 0 })
  otpAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  otpLockedUntil?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;
}
