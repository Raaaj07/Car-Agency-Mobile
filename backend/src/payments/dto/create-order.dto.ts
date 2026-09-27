import { IsIn, IsUUID } from 'class-validator';
import { PaymentMethod } from '../../rides/entities/ride.entity';

// Matches RideDetailsScreen / VehicleSelectionScreen's payment selector and
// PaymentFareBreakdownScreen's checkout — one of upi, wallet, card, cash.
export class CreateOrderDto {
  @IsUUID()
  rideId!: string;

  @IsIn(['upi', 'wallet', 'card', 'cash'])
  method!: PaymentMethod;
}
