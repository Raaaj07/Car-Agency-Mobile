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
import { SetUpiVpaDto } from './dto/set-upi-vpa.dto';
import { ApprovedDriverGuard } from './guards/approved-driver.guard';
import { DriversService } from './drivers.service';
import { DocumentKind, StorageService, StoredDocument } from './storage.service';

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

    // Upload the three documents in parallel. If anything fails (an upload or
    // the DB write), delete whatever already reached Cloudinary so no orphans remain.
    const jobs: Array<[DocumentKind, Express.Multer.File]> = [
      ['licenseImage', license],
      ['rcImage', rc],
    ];
    if (vehicle) jobs.push(['vehiclePhoto', vehicle]);

    const settled = await Promise.allSettled(jobs.map(([kind, f]) => this.storage.storeDocument(user.userId, kind, f)));
    const stored = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      await this.discard(stored);
      throw failed.reason;
    }

    const byKind = (k: DocumentKind): StoredDocument | undefined => stored.find((d) => d.kind === k);
    try {
      return await this.drivers.applyApplication(
        user.userId,
        {
          vehicleType: dto.vehicleType,
          carModel: dto.carModel,
          plateNumber: dto.plateNumber,
          licenseNumber: dto.licenseNumber,
          rcNumber: dto.rcNumber,
        },
        {
          licenseImagePath: byKind('licenseImage')!.path,
          rcImagePath: byKind('rcImage')!.path,
          vehiclePhotoPath: byKind('vehiclePhoto')?.path ?? null,
        },
      );
    } catch (err) {
      // e.g. 409 "already pending" — don't leave the fresh uploads behind.
      await this.discard(stored);
      throw err;
    }
  }

  private async discard(docs: StoredDocument[]): Promise<void> {
    await Promise.all(docs.map((d) => this.storage.deleteDocument(d.path)));
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

  // D-1: payee VPA for the payment QR (approved only, validated, audited).
  @UseGuards(JwtAuthGuard, ApprovedDriverGuard)
  @Patch('me/upi-vpa')
  setMyUpiVpa(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetUpiVpaDto) {
    return this.drivers.setMyUpiVpa(user.userId, dto.vpa);
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
