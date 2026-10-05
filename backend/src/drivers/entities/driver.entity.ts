import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { DriverInfo as FrontendDriverInfo, VehicleOption } from '../../common/frontend-contracts';

export type VehicleType = 'auto' | 'mini' | 'sedan' | 'suv';

// Matches the four VehicleOption entries hardcoded on VehicleSelectionScreen,
// used to derive display fields (name/type/icon/seats) for a driver's vehicle.
export const VEHICLE_CATALOG: Record<VehicleType, Omit<VehicleOption, 'price' | 'numericPrice' | 'eta'>> = {
  auto: { id: 'auto', name: 'Vazhi Auto', type: 'Affordable 3-wheeler', seats: 3, badge: 'Popular', icon: '🛺' },
  mini: { id: 'mini', name: 'Economy Mini', type: 'Compact hatchbacks', seats: 4, icon: '🚗' },
  sedan: { id: 'sedan', name: 'Comfort Sedan', type: 'Spacious AC sedans', seats: 4, badge: 'Fastest', icon: '🚘' },
  suv: { id: 'suv', name: 'Premium SUV', type: '6-seater family rides', seats: 6, icon: '🚙' },
};

@Entity('drivers')
export class DriverEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  @Column({ type: 'varchar', length: 10 })
  vehicleType!: VehicleType;

  @Column({ type: 'varchar', length: 120 })
  carModel!: string;

  @Column({ type: 'varchar', length: 20 })
  plateNumber!: string;

  // ── Driver onboarding documents (uploaded from Profile > Become a Driver) ──
  // Stored as URLs (Supabase/S3) or data-URLs for local dev. All nullable so
  // legacy rows without documents keep working.
  @Column({ type: 'text', nullable: true })
  profilePhotoUrl?: string | null;

  @Column({ type: 'text', nullable: true })
  carImageUrl?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  drivingLicenceNumber?: string | null;

  @Column({ type: 'text', nullable: true })
  drivingLicenceImageUrl?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  rcNumber?: string | null;

  @Column({ type: 'text', nullable: true })
  rcImageUrl?: string | null;

  // D-1: payee VPA for the payment QR, stored server-side (validated +
  // approved-only edits + `upi_update` audit) instead of only device
  // SecureStore, so admins can see what a ride's QR paid to.
  @Column({ type: 'varchar', length: 64, nullable: true })
  upiVpa?: string | null;

  // Canonical application lifecycle (Phase 2). One profile per user, so
  // state lives on this row. The deprecated verificationStatus/verificationNote
  // columns were dropped by migration 1791200002000 (D-2).
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: 'pending' | 'approved' | 'rejected' | 'suspended';

  @Column({ type: 'varchar', length: 300, nullable: true })
  rejectionReason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  // Set on approve/reinstate; reinstate is only legal while this is set (A-2).
  @Column({ type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt?: Date | null;

  // Local-disk document paths (backend/uploads/, never public static).
  // URL fields above remain for legacy/remote URIs.
  @Column({ type: 'text', nullable: true })
  licenseImagePath?: string | null;

  @Column({ type: 'text', nullable: true })
  rcImagePath?: string | null;

  @Column({ type: 'text', nullable: true })
  vehiclePhotoPath?: string | null;

  @Column({ type: 'boolean', default: false })
  isOnline!: boolean;

  // Online but not currently on an active ride.
  @Column({ type: 'boolean', default: false })
  isAvailable!: boolean;

  // Authoritative location record (PostGIS), kept in sync with the Redis
  // geo-set used for fast lookups. SRID 4326 = plain lat/lng (WGS84).
  @Index({ spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location?: { type: 'Point'; coordinates: [number, number] } | null;

  @Column({ type: 'timestamptz', nullable: true })
  locationUpdatedAt?: Date | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 4.8 })
  rating!: string;

  @Column({ type: 'int', default: 0 })
  totalTrips!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Maps this driver (+ the owning user) to the exact `DriverInfo` shape the
   * frontend's rideStore expects (Trip Progress / You Got The Ride screens).
   */
  toFrontendDriverInfo(opts: { eta: string; otp: string }): FrontendDriverInfo {
    return {
      name: this.user?.name ?? 'Driver',
      rating: Number(this.rating),
      carModel: this.carModel,
      plateNumber: this.plateNumber,
      otp: opts.otp,
      eta: opts.eta,
      phone: this.user?.phone ?? '',
    };
  }
}
