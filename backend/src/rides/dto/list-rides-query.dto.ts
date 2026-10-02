import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, Max } from 'class-validator';

// Matches the "My Rides" tab (RiderTabParamList.MyRidesTab).
export class ListRidesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  // Unified accounts hold both roles: ?as=rider shows bookings made,
  // ?as=driver shows trips driven. Defaults to the JWT role for compat.
  @IsOptional()
  @IsIn(['rider', 'driver'])
  as?: 'rider' | 'driver';
}
