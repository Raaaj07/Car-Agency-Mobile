import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

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

  // RoleSelectionScreen result, only used the first time a user is created.
  @IsOptional()
  @IsIn(['rider', 'driver'])
  role?: 'rider' | 'driver';

  @IsOptional()
  @IsString()
  name?: string;
}
