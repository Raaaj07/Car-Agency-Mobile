import { IsOptional, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit mobile number',
  })
  phone!: string;

  // OTPVerificationScreen renders otpLength boxes (server-reported, 4..8;
  // legacy servers/apps default to 4). The width must match what the server
  // issued — a wrong-width code can never compare equal anyway (AU-2), and
  // clamping OTP_LENGTH to 4..8 keeps this regex and the generator in sync.
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'otp must be a 4 to 8 digit code' })
  otp!: string;

  @IsOptional()
  @IsString()
  name?: string;

  /**
   * LEGACY, IGNORED. Older app builds (from when onboarding asked the user to
   * pick rider/driver) still send `role`. The global ValidationPipe uses
   * forbidNonWhitelisted, so without this field those logins fail with
   * "property role should not exist". The server NEVER reads it: new users are
   * always riders, and admin comes only from ADMIN_PHONES (see AuthService).
   */
  @IsOptional()
  @IsString()
  role?: string;
}
