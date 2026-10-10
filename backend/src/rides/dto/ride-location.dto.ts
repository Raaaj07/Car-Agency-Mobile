import { IsLatitude, IsLongitude, IsString, MaxLength, MinLength } from 'class-validator';

export class RideLocationDto {
  @IsString()
  @MinLength(2)
  // SEC-2: address is stored on the ride rows — cap it at the column-scale
  // size the UI can actually render (saved places use the same bound).
  @MaxLength(300)
  address!: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;
}
