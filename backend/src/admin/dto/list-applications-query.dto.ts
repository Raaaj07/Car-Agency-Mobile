import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListApplicationsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'suspended'])
  status?: string;

  // `?online=true`: only drivers that are online right now (the Overview
  // "Online drivers" card). Query strings are text, hence the transform.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  online?: boolean;

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
