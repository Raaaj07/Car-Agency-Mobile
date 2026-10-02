import { BadRequestException, Body, Controller, Get, Patch, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NearbyDriversQueryDto } from './dto/nearby-drivers-query.dto';
import { ApplyDriverDto } from './dto/apply-driver.dto';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import { ApprovedDriverGuard } from './guards/approved-driver.guard';
import { DriversService } from './drivers.service';
import { DocumentKind, StorageService } from './storage.service';

const APPLY_FILES_LIMIT = 5 * 1024 * 1024;

@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly storage: StorageService,
  ) {}

  // Driver application with document uploads (multipart). Any authenticated
  // rider; allowed when never applied or after rejection.
  @UseGuards(JwtAuthGuard)
  @Post('apply')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'licenseImage', maxCount: 1 },
        { name: 'rcImage', maxCount: 1 },
        { name: 'vehiclePhoto', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: APPLY_FILES_LIMIT, files: 3 } },
    ),
  )
  async apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyDriverDto,
    @UploadedFiles()
    files: { licenseImage?: Express.Multer.File[]; rcImage?: Express.Multer.File[]; vehiclePhoto?: Express.Multer.File[] },
  ) {
    const license = files?.licenseImage?.[0];
    const rc = files?.rcImage?.[0];
    const vehicle = files?.vehiclePhoto?.[0];
    if (!license) throw new BadRequestException('licenseImage is required');
    if (!rc) throw new BadRequestException('rcImage is required');
    const storedLicense = this.storage.validateAndStore(user.userId, 'licenseImage' as DocumentKind, license);
    const storedRc = this.storage.validateAndStore(user.userId, 'rcImage' as DocumentKind, rc);
    const storedVehicle = vehicle
      ? this.storage.validateAndStore(user.userId, 'vehiclePhoto' as DocumentKind, vehicle)
      : null;
    return this.drivers.applyApplication(
      user.userId,
      {
        vehicleType: dto.vehicleType,
        carModel: dto.carModel,
        plateNumber: dto.plateNumber,
        licenseNumber: dto.licenseNumber,
        rcNumber: dto.rcNumber,
      },
      {
        licenseImagePath: storedLicense.path,
        rcImagePath: storedRc.path,
        vehiclePhotoPath: storedVehicle?.path ?? null,
      },
    );
  }

  // Own application status (null when never applied).
  @UseGuards(JwtAuthGuard)
  @Get('application')
  getApplication(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.getApplication(user.userId);
  }

  // Matches DriverDashboardScreen's online/offline Switch (approved only).
  @UseGuards(JwtAuthGuard, ApprovedDriverGuard)
  @Post('status')
  setStatus(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateDriverStatusDto) {
    return this.drivers.setStatus(user.userId, dto.isOnline);
  }

  // Matches DriverDashboardScreen's top bar + earnings card, and DriverAccountScreen.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.tryGetMyProfile(user.userId);
  }

  // Matches TurnByTurnNavigationScreen's periodic location pings (approved only).
  @UseGuards(JwtAuthGuard, ApprovedDriverGuard)
  @Patch('location')
  updateLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateDriverLocationDto) {
    return this.drivers.updateLocation(user.userId, dto.lat, dto.lng);
  }

  // Matches VehicleSelectionScreen / FindingDriverScreen — driver search
  // around the rider's pickup point, optionally filtered by vehicle type.
  @UseGuards(JwtAuthGuard)
  @Get('nearby')
  findNearby(@Query() query: NearbyDriversQueryDto) {
    return this.drivers.findNearby(
      query.lat,
      query.lng,
      query.radiusMeters,
      query.vehicleType,
      query.groupByType,
    );
  }
}
