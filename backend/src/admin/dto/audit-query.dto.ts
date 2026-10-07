import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** GET /admin/audit — paginated audit feed with optional narrowing. */
export class AuditQueryDto {
  // MaxLength, not Max: @Max is a NUMERIC validator and always fails on a
  // string, so any request carrying one of these filters used to get a 400
  // ("action must not be greater than 40").
  @IsOptional()
  @IsString()
  @MaxLength(40)
  action?: string;

  @IsOptional()
  @IsIn(['driver', 'ride'])
  targetType?: 'driver' | 'ride';

  @IsOptional()
  @IsString()
  @MaxLength(36)
  targetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  actorUserId?: string;

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
