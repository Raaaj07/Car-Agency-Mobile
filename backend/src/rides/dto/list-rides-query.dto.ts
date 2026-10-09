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
  // SEC-5: cap the page so the OFFSET cannot be driven into a full-table
  // walk (1000 pages x the 100-row limit cap = 100k rides of history).
  @Max(1000)
  page?: number;

  // Unified accounts hold both roles: ?as=rider shows bookings made,
  // ?as=driver shows trips driven. Defaults to the JWT role for compat.
  @IsOptional()
  @IsIn(['rider', 'driver'])
  as?: 'rider' | 'driver';
}
