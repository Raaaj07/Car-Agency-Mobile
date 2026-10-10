import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { VehicleType } from '../../drivers/entities/driver.entity';
import { PaymentMethod } from '../entities/ride.entity';
import { RideLocationDto } from './ride-location.dto';

// Matches the Vehicle Selection -> Ride Details booking flow.
export class CreateRideDto {
  @ValidateNested()
  @Type(() => RideLocationDto)
  pickup!: RideLocationDto;

  @ValidateNested()
  @Type(() => RideLocationDto)
  dropoff!: RideLocationDto;

  @IsIn(['auto', 'mini', 'sedan', 'suv'])
  vehicleType!: VehicleType;

  @IsOptional()
  @IsString()
  // SEC-2: stored (normalized) on the ride — bound the length so a huge
  // payload cannot ride along with the booking. Trim+uppercase happens
  // service-side, unchanged.
  @MaxLength(32)
  promoCode?: string;

  @IsOptional()
  @IsIn(['upi', 'wallet', 'card', 'cash'])
  paymentMethod?: PaymentMethod;

  @IsOptional()
  allowUpgrade?: boolean;
}
