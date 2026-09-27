import { IsLatitude, IsLongitude, IsString, MinLength } from 'class-validator';

export class RideLocationDto {
  @IsString()
  @MinLength(2)
  address!: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;
}
