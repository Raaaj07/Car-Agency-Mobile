import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * Admin create/update body for a promo (POST/PATCH /admin/promos).
 * Optional fields: omitted = unchanged on PATCH, null clears a validity date.
 */
export class PromoAdminDto {
  @IsString()
  @Length(3, 30)
  code!: string;

  @IsInt()
  @Min(0)
  discountAmount!: number;

  // Copy fields accept null to clear (falls back to the composed default).
  @IsOptional()
  @IsString()
  @Length(1, 140)
  title?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  cta?: string | null;

  @IsOptional()
  @IsBoolean()
  firstRideOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // IsOptional also skips null (class-validator treats null as "absent"), so a
  // client can clear a window by sending `validFrom: null`.
  @IsOptional()
  @IsDateString()
  validFrom?: string | null;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;
}
