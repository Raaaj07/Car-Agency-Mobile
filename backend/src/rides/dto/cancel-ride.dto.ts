import { IsString, MaxLength, MinLength } from 'class-validator';

// Matches CancelRideConfirmationScreen's reason picker. The frontend sends
// whichever of its 5 preset reasons (or a custom one) the user picked.
export class CancelRideDto {
  @IsString()
  @MinLength(3)
  // SEC-2: reason is stored on the ride row (and shown in admin lists) —
  // same 300-char scale the admin cancel DTO already uses.
  @MaxLength(300)
  reason!: string;
}
