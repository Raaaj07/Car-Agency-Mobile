import { IsNumber, IsOptional, IsPositive } from 'class-validator';

// Matches Trip Progress -> the driver app reports the actual distance
// covered so the final fare (shown on PaymentFareBreakdownScreen) can be
// recalculated instead of using the booking-time estimate.
export class CompleteRideDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  actualDistanceKm?: number;
}
