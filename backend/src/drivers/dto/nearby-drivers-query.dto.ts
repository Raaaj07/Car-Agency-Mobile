import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsLatitude, IsLongitude, IsOptional, IsPositive } from 'class-validator';
import { VehicleType } from '../entities/driver.entity';

export class NearbyDriversQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  radiusMeters?: number;

  // Matches VehicleSelectionScreen's vehicle ids (auto/mini/sedan/suv).
  @IsOptional()
  @IsIn(['auto', 'mini', 'sedan', 'suv'])
  vehicleType?: VehicleType;

  // Query strings arrive as text. `@Type(() => Boolean)` made "false" -> true
  // (Boolean('false') is truthy), so ?groupByType=false grouped anyway.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  groupByType?: boolean;
}
