import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * GET /admin/users — user management list filters (Task 9).
 * `q` matches name / phone / email (full phones are returned on this
 * endpoint, same as driver applications — the phone is the account key).
 */
export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['rider', 'driver', 'admin'])
  role?: 'rider' | 'driver' | 'admin';

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
