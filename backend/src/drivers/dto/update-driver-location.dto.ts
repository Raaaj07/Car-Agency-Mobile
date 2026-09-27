import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

// Matches driver-side periodic pings feeding TurnByTurnNavigationScreen's
// map and the rider's live tracking on TripProgressScreen.
export class UpdateDriverLocationDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsString()
  rideId?: string;
}
