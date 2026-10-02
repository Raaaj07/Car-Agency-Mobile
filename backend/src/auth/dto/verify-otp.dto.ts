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
}
