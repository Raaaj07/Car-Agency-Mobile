import { Matches } from 'class-validator';

// Matches the "START RIDE OTP" shown on YouGotTheRideScreen, entered by the
// driver on DriverEnRouteScreen's "Driver Arrived (Start)" action.
export class VerifyPickupOtpDto {
  @Matches(/^\d{4}$/, { message: 'otp must be a 4-digit code' })
  otp!: string;
}
