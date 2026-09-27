import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NearbyDriversQueryDto } from './dto/nearby-drivers-query.dto';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import { DriversService } from './drivers.service';

@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  // Onboards vehicle/plate details for a driver before they can go online.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  @Post('register')
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDriverDto) {
    return this.drivers.registerOrUpdate(user.userId, dto);
  }

  // Matches DriverDashboardScreen's online/offline Switch.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  @Post('status')
  setStatus(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateDriverStatusDto) {
    return this.drivers.setStatus(user.userId, dto.isOnline);
  }

  // Matches DriverDashboardScreen's top bar + earnings card, and DriverAccountScreen.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  @Get('me')
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.getMyProfile(user.userId);
  }

  // Matches TurnByTurnNavigationScreen's periodic location pings.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  @Patch('location')
  updateLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateDriverLocationDto) {
    return this.drivers.updateLocation(user.userId, dto.lat, dto.lng);
  }

  // Matches VehicleSelectionScreen / FindingDriverScreen — driver search
  // around the rider's pickup point, optionally filtered by vehicle type.
  @UseGuards(JwtAuthGuard)
  @Get('nearby')
  findNearby(@Query() query: NearbyDriversQueryDto) {
    return this.drivers.findNearby(query.lat, query.lng, query.radiusMeters, query.vehicleType);
  }
}
