import { Type } from 'class-transformer';
import { IsIn, IsLatitude, IsLongitude, IsOptional, IsPositive } from 'class-validator';
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

  @IsOptional()
  @Type(() => Boolean)
  groupByType?: boolean;
}
