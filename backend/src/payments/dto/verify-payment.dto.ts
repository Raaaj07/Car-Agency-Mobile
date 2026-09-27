import { IsOptional, IsString, IsUUID } from 'class-validator';

export class VerifyPaymentDto {
  @IsUUID()
  rideId!: string;

  @IsString()
  orderId!: string;

  // Cash payments have no provider payment/signature to verify.
  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  signature?: string;
}
