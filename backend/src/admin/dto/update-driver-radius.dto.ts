import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * PUT /admin/settings/driver-radius body. Kilometres (what the admin types),
 * 1 decimal place, 1–50 km — the service converts to metres and re-validates.
 */
export class UpdateDriverRadiusDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(50)
  radiusKm!: number;
}
