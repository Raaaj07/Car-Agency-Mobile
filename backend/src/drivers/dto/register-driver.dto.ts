import { IsIn, IsString, MinLength } from 'class-validator';
import { VehicleType } from '../entities/driver.entity';

// Not shown on any single screen explicitly, but required before a
// newly-onboarded driver (RoleSelectionScreen -> "driver") can go online:
// DriverDashboardScreen assumes a vehicle/plate already exist.
export class RegisterDriverDto {
  @IsIn(['auto', 'mini', 'sedan', 'suv'])
  vehicleType!: VehicleType;

  @IsString()
  @MinLength(2)
  carModel!: string;

  @IsString()
  @MinLength(4)
  plateNumber!: string;
}
