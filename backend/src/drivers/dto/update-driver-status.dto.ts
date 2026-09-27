import { IsBoolean } from 'class-validator';

// Matches DriverDashboardScreen's online/offline Switch.
export class UpdateDriverStatusDto {
  @IsBoolean()
  isOnline!: boolean;
}
