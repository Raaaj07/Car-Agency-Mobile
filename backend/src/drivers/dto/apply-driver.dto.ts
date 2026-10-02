import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { VehicleType } from '../entities/driver.entity';

export class ApplyDriverDto {
  @IsIn(['auto', 'mini', 'sedan', 'suv'])
  vehicleType!: VehicleType;

  @IsString()
  @MinLength(2)
  carModel!: string;

  @IsString()
  @MinLength(4)
  plateNumber!: string;

  @IsString()
  @MinLength(4)
  licenseNumber!: string;

  @IsOptional()
  @IsString()
  rcNumber?: string;
}
