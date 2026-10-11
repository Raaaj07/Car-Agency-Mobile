import { IsArray, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Pass-4 (task 5): top-level shape of a Razorpay event delivery. The global
 * forbidNonWhitelisted pipe would 400 a legitimate delivery that carries a
 * field we forgot to declare, so the standard event keys are all listed.
 * `payload` is authenticated by the HMAC signature check BEFORE anything
 * inside it is used, and its contents are narrowed with runtime type guards
 * in the service — never trusted from the DTO alone.
 */
export class RazorpayWebhookDto {
  /** Event name, e.g. `payment.captured` / `order.paid`. */
  @IsString()
  @MaxLength(64)
  event!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  account?: string;

  @IsOptional()
  @IsArray()
  contains?: string[];

  @IsOptional()
  @IsInt()
  created_at?: number;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
