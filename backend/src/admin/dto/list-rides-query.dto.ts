import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * GET /admin/rides — filters for the admin rides console (Section 3.2).
 * `status` / `paymentStatus` accept comma-separated values so chips can query
 * groups in one request (e.g. Active = requested,matched,driver_en_route,
 * in_progress; Unpaid = pending,rider_claimed,disputed,failed). Membership is
 * validated against the whitelists in AdminService.listRides.
 */
export class ListRidesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  paymentStatus?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Free text over ride id, rider/driver name and plate — never matches or
  // returns phone numbers.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  // UUID columns: a malformed value used to reach Postgres and surface as a
  // 500 ("invalid input syntax for type uuid"); reject it as a 400 instead.
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  riderId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
