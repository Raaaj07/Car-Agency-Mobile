import { IsString, MinLength } from 'class-validator';

// Matches CancelRideConfirmationScreen's reason picker. The frontend sends
// whichever of its 5 preset reasons (or a custom one) the user picked.
export class CancelRideDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
