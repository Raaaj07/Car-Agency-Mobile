import { IsOptional, IsString, Matches } from 'class-validator';

export class SendOtpDto {
  // Accepts a bare 10-digit Indian mobile number, matching the
  // MobileNumberScreen input (10 digits, +91 shown as a fixed prefix).
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit mobile number',
  })
  phone!: string;

  /**
   * LEGACY, IGNORED. Older app builds send `role` with the phone number; see
   * VerifyOtpDto. Never read by the server.
   */
  @IsOptional()
  @IsString()
  role?: string;
}
