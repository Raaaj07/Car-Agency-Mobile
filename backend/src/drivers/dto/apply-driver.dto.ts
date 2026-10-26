import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { VehicleType } from '../entities/driver.entity';

export class ApplyDriverDto {
  @IsIn(['auto', 'mini', 'sedan', 'suv'])
  vehicleType!: VehicleType;

  // SEC-2: every field below is stored on the driver/application rows —
  // caps match what the forms can meaningfully hold (Indian plate ~12,
  // DL/RC numbers well under 32).
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  carModel!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(20)
  plateNumber!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(32)
  licenseNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  rcNumber?: string;
}
