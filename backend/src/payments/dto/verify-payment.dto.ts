import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class VerifyPaymentDto {
  @IsUUID()
  rideId!: string;

  // SEC-2: provider references end up on the ride/audit rows — cap them to
  // the sizes Razorpay actually issues (order ~14, payment ~14, sig ~64 hex).
  @IsString()
  @MaxLength(64)
  orderId!: string;

  // Cash payments have no provider payment/signature to verify.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  signature?: string;
}
