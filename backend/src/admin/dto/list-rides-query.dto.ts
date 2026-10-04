import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentStatus, RideStatus } from '../../rides/entities/ride.entity';

const RIDE_STATUSES: RideStatus[] = [
  'requested',
  'matched',
  'driver_en_route',
  'in_progress',
  'completed',
  'cancelled',
];
const PAYMENT_STATUSES: PaymentStatus[] = ['pending', 'rider_claimed', 'paid', 'disputed', 'failed'];

/** GET /admin/rides — filters for the admin rides console (Section 3.2). */
export class ListRidesQueryDto {
  @IsOptional()
  @IsIn(RIDE_STATUSES)
  status?: RideStatus;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Free text over ride id, rider/driver name and plate — never matches or
  // returns phone numbers.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  driverId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  riderId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
