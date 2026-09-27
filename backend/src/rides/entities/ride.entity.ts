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
export type PaymentStatus = 'pending' | 'paid' | 'failed';

export interface RideLocation {
  address: string;
  lat: number;
  lng: number;
}

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
  cancelledBy?: 'rider' | 'driver' | null;

  @Column({ type: 'varchar', length: 10, default: 'upi' })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  paymentStatus!: PaymentStatus;

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
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;
}
