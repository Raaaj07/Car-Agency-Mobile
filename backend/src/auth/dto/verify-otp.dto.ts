import { IsOptional, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit mobile number',
  })
  phone!: string;

  // OTPVerificationScreen collects a 4-digit code.
  @IsString()
  @Matches(/^\d{4}$/, { message: 'otp must be a 4-digit code' })
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
