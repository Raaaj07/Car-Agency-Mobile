import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** GET /admin/audit — paginated audit feed with optional narrowing. */
export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @Max(40)
  action?: string;

  @IsOptional()
  @IsIn(['driver', 'ride'])
  targetType?: 'driver' | 'ride';

  @IsOptional()
  @IsString()
  @Max(36)
  targetId?: string;

  @IsOptional()
  @IsString()
  @Max(36)
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
