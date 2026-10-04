import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListApplicationsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'suspended'])
  status?: string;

  // Name / phone / plate search (ILIKE), 300 ms debounced by the console.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  // Queue order. Default: oldest for `pending` (A-10), newest otherwise.
  @IsOptional()
  @IsIn(['oldest', 'newest'])
  sort?: 'oldest' | 'newest';

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
