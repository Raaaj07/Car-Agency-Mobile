import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DriverEntity, VehicleType } from './entities/driver.entity';
import { GeoService, NearbyDriverHit } from './geo.service';
import { RideEntity } from '../rides/entities/ride.entity';
import { StorageService } from './storage.service';

export interface NearbyDriverResult {
  driverId: string;
  userId: string;
  name: string;
  vehicleType: VehicleType;
  carModel?: string;
  rating: number;
  distanceMeters: number;
  etaMinutes: number;
  lat: number;
  lng: number;
  heading?: number;
}

@Injectable()
export class DriversService {
  private readonly defaultRadiusMeters: number;

    constructor(
      @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
      @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>, // ADD
      private readonly geo: GeoService,
      private readonly config: ConfigService,
      private readonly storage: StorageService,
    ) {
      this.defaultRadiusMeters = this.config.get<number>('DRIVER_SEARCH_RADIUS_METERS') ?? 5000;
    }


  /** POST /drivers/apply — multipart application (any authenticated rider). */
  async applyApplication(
    userId: string,
    data: { vehicleType: VehicleType; carModel: string; plateNumber: string; licenseNumber: string; rcNumber?: string },
    files: { licenseImagePath?: string | null; rcImagePath?: string | null; vehiclePhotoPath?: string | null },
  ): Promise<DriverEntity> {
    let driver = await this.drivers.findOne({ where: { userId } });
    const cur = driver ? (((driver as any).status as string | undefined) ?? undefined) : undefined;
    // Only none (no row) or rejected may (re-)submit.
    if (cur === 'pending' || cur === 'approved' || cur === 'suspended') {
      throw new ConflictException(`Application already ${cur}; re-submit is allowed only after rejection`);
    }
    if (!driver) {
      driver = this.drivers.create({ userId, isOnline: false, isAvailable: false });
    }
    // Remember the previous (rejected) application's documents so they can be
    // removed from storage once the new ones are saved.
    const previousDocs = [
      (driver as any).licenseImagePath,
      (driver as any).rcImagePath,
      (driver as any).vehiclePhotoPath,
    ].filter((v): v is string => !!v);
    driver.vehicleType = data.vehicleType;
    driver.carModel = data.carModel;
    driver.plateNumber = data.plateNumber;
    driver.drivingLicenceNumber = data.licenseNumber;
    if (data.rcNumber !== undefined) driver.rcNumber = data.rcNumber || null;
    if (files.licenseImagePath !== undefined) (driver as any).licenseImagePath = files.licenseImagePath;
    if (files.rcImagePath !== undefined) (driver as any).rcImagePath = files.rcImagePath;
    if (files.vehiclePhotoPath !== undefined) (driver as any).vehiclePhotoPath = files.vehiclePhotoPath;
    (driver as any).status = 'pending';
    (driver as any).submittedAt = new Date();
    (driver as any).rejectionReason = null;
    (driver as any).reviewedByUserId = null;
    (driver as any).reviewedAt = null;
    const saved = await this.drivers.save(driver);

    const kept = new Set([files.licenseImagePath, files.rcImagePath, files.vehiclePhotoPath]);
    await Promise.all(previousDocs.filter((p) => !kept.has(p)).map((p) => this.storage.deleteDocument(p)));
    return saved;
  }

  /** GET /drivers/application — own application status (null when never applied). */
  async getApplication(userId: string) {
    const driver = await this.drivers.findOne({ where: { userId }, relations: ['user'] });
    if (!driver) return null;
    const d = driver as any;
    return {
      status: d.status ?? 'pending',
      rejectionReason: d.rejectionReason ?? null,
      submittedAt: d.submittedAt ?? driver.createdAt,
      reviewedAt: d.reviewedAt ?? null,
      vehicleType: driver.vehicleType,
      carModel: driver.carModel,
      plateNumber: driver.plateNumber,
      licenseNumber: driver.drivingLicenceNumber ?? null,
      rcNumber: driver.rcNumber ?? null,
      hasLicenseImage: !!(d.licenseImagePath || driver.drivingLicenceImageUrl),
      hasRcImage: !!(d.rcImagePath || driver.rcImageUrl),
      hasVehiclePhoto: !!(d.vehiclePhotoPath || driver.carImageUrl),
    };
  }

  async findByUserId(userId: string): Promise<DriverEntity> {
    const driver = await this.drivers.findOne({ where: { userId }, relations: ['user'] });
    if (!driver) {
      throw new NotFoundException('Driver profile not found for this user');
    }
    return driver;
  }

  async findById(driverId: string): Promise<DriverEntity> {
    const driver = await this.drivers.findOne({ where: { id: driverId }, relations: ['user'] });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }
    return driver;
  }

  // POST /drivers/status — DriverDashboardScreen's online/offline Switch.
  async setStatus(userId: string, isOnline: boolean): Promise<DriverEntity> {
    const driver = await this.findByUserId(userId);

    if (isOnline) {
      // R-3: a driver mid-trip must never re-enter the available pool — they
      // would be offered a second ride while still on one. (Going offline
      // mid-trip stays allowed; isAvailable is forced false below.)
      const activeTrip = await this.rides.findOne({
        where: { driverId: driver.id, status: In(['matched', 'driver_en_route', 'in_progress']) },
      });
      if (activeTrip) {
        throw new ConflictException(
          `You have an active ride (${activeTrip.status}). Finish it before going online.`,
        );
      }
      const status = ((driver as any).status as string | undefined) ?? 'pending';
      if (status === 'pending') {
        throw new ConflictException('Driver verification pending. You can go online once approved.');
      }
      if (status === 'rejected') {
        const note = (driver as any).rejectionReason as string | null;
        throw new ConflictException(note ?? 'Driver application was rejected. Please re-submit your documents.');
      }
      if (status === 'suspended') {
        throw new ConflictException('Driver access suspended — contact support.');
      }
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      if (!driver.location || !driver.locationUpdatedAt || driver.locationUpdatedAt < twoMinutesAgo) {
        throw new ConflictException('Location required to go online. Please ensure GPS is active.');
      }
    }

    driver.isOnline = isOnline;
    driver.isAvailable = isOnline;
    await this.drivers.save(driver);

    if (isOnline && driver.location) {
      const [lng, lat] = driver.location.coordinates;
      await this.geo.upsertDriverLocation(driver.id, driver.vehicleType, lat, lng);
    } else {
      await this.geo.removeDriver(driver.id, driver.vehicleType);
    }

    return driver;
  }

  // Called internally when a driver accepts/completes/cancels a ride.
  async setAvailability(driverId: string, isAvailable: boolean): Promise<void> {
    await this.drivers.update({ id: driverId }, { isAvailable });
  }

  // Called by RidesService after ReviewRideScreen submits a star rating —
  // rolls the new rating into the driver's running average (atomic, no lost writes).
  async applyRating(driverId: string, newRating: number): Promise<void> {
    if (!Number.isFinite(newRating) || newRating < 1 || newRating > 5) return;
    // Atomic: rating = (rating*totalTrips + new)/(totalTrips+1), totalTrips+1.
    await this.drivers
      .createQueryBuilder()
      .update(DriverEntity)
      .set({
        rating: () => `LEAST(9.99, (rating::numeric * "totalTrips" + :newRating) / ("totalTrips" + 1))`,
        totalTrips: () => `"totalTrips" + 1`,
      })
      .where('id = :driverId', { driverId })
      .setParameters({ newRating })
      .execute();
  }

  // PATCH /drivers/location — periodic pings from the driver app.
  async updateLocation(userId: string, lat: number, lng: number): Promise<DriverEntity> {
    const driver = await this.findByUserId(userId);
    driver.location = { type: 'Point', coordinates: [lng, lat] };
    driver.locationUpdatedAt = new Date();
    await this.drivers.save(driver);

    if (driver.isOnline) {
      await this.geo.upsertDriverLocation(driver.id, driver.vehicleType, lat, lng);
    }
    return driver;
  }
  
  // New method — matches GET /drivers/me:
  async getMyProfile(userId: string) {
    const driver = await this.findByUserId(userId); // already loads relations: ['user']

    // UTC day boundary (server TZ-independent).
    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const { sum, count } = await this.rides
    .createQueryBuilder('ride')
    .select(`COALESCE(SUM((ride."fareBreakdown"->>'total')::numeric), 0)`, 'sum')
    .addSelect('COUNT(*)', 'count')
    .where('ride.driverId = :driverId', { driverId: driver.id })
    .andWhere('ride.status = :status', { status: 'completed' })
    .andWhere('ride.completedAt >= :start', { start: startOfTodayUtc })
    .getRawOne();

  return {
    name: driver.user?.name ?? 'Driver',
    phone: driver.user?.phone ?? '',
    avatar: driver.user?.avatar ?? null,
    vehicleType: driver.vehicleType,
    carModel: driver.carModel,
    plateNumber: driver.plateNumber,
    rating: Number(driver.rating),
    totalTrips: driver.totalTrips, // lifetime, real column
    todayEarnings: Number(sum ?? 0),
    todayTrips: Number(count ?? 0),
    isOnline: driver.isOnline,
    isAvailable: driver.isAvailable,
    status: ((driver as any).status as string | undefined) ?? 'approved',
    rejectionReason: ((driver as any).rejectionReason as string | null) ?? null,
    submittedAt: ((driver as any).submittedAt as Date | null) ?? driver.createdAt,
    profilePhotoUrl: driver.profilePhotoUrl ?? null,
    carImageUrl: driver.carImageUrl ?? null,
    drivingLicenceNumber: driver.drivingLicenceNumber ?? null,
    drivingLicenceImageUrl: driver.drivingLicenceImageUrl ?? null,
    rcNumber: driver.rcNumber ?? null,
    rcImageUrl: driver.rcImageUrl ?? null,
  };
  }

  /** Null (not 404) when the user has never registered as a driver. */
  async tryGetMyProfile(userId: string) {
    const driver = await this.drivers.findOne({ where: { userId }, relations: ['user'] });
    if (!driver) return null;
    return this.getMyProfile(userId);
  }

  // GET /drivers/nearby — Redis GEOSEARCH first, PostGIS ST_DWithin fallback.
  async findNearby(
    lat: number,
    lng: number,
    radiusMeters?: number,
    vehicleType?: VehicleType,
    groupByType?: boolean,
  ): Promise<any> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat/lng required');
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new BadRequestException('lat/lng out of range');
    }
    // Cap radius to prevent full-table GEOSEARCH/PostGIS scans.
    const radius = Math.min(radiusMeters ?? this.defaultRadiusMeters, 20000);
    const ninetySecAgo = new Date(Date.now() - 90 * 1000);

    let results: NearbyDriverResult[] = [];
    const redisHits = await this.geo.searchNearby(lat, lng, radius, vehicleType);
    if (redisHits.length > 0) {
      results = await this.hydrateFromRedis(redisHits, ninetySecAgo);
    }

    // Fall back to PostGIS if Redis returned 0 results or all were filtered out
    if (results.length === 0) {
      results = await this.findNearbyViaPostgis(lat, lng, radius, vehicleType, ninetySecAgo);
    }

    if (groupByType) {
      const countsByType: Record<string, { count: number; bestEtaMinutes: number | null }> = {
        auto: { count: 0, bestEtaMinutes: null },
        mini: { count: 0, bestEtaMinutes: null },
        sedan: { count: 0, bestEtaMinutes: null },
        suv: { count: 0, bestEtaMinutes: null },
      };
      for (const d of results) {
        if (countsByType[d.vehicleType]) {
          countsByType[d.vehicleType].count += 1;
          const current = countsByType[d.vehicleType].bestEtaMinutes;
          countsByType[d.vehicleType].bestEtaMinutes =
            current === null ? d.etaMinutes : Math.min(current, d.etaMinutes);
        }
      }
      return { drivers: results, countsByType };
    }

    return results;
  }
  
  private async hydrateFromRedis(hits: NearbyDriverHit[], minUpdatedAt: Date): Promise<NearbyDriverResult[]> {
    const ids = [...new Set(hits.map((h) => h.driverId))].slice(0, 20);
    if (ids.length === 0) return [];
    const rows = await this.drivers.find({
      where: { id: In(ids) },
      relations: ['user'],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    return hits
      .filter((h) => {
        const d = byId.get(h.driverId);
        return (
          d?.isOnline &&
          d?.isAvailable &&
          d.locationUpdatedAt &&
          d.locationUpdatedAt >= minUpdatedAt
        );
      })
      .map((h) => {
        const d = byId.get(h.driverId)!;
        return this.toResult(d, h.distanceMeters, h.lat, h.lng);
      });
  }

  private async findNearbyViaPostgis(
    lat: number,
    lng: number,
    radiusMeters: number,
    vehicleType?: VehicleType,
    minUpdatedAt?: Date,
  ): Promise<NearbyDriverResult[]> {
    const ninetySecAgo = minUpdatedAt ?? new Date(Date.now() - 90 * 1000);
    const qb = this.drivers
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.user', 'user')
      .addSelect(
        `ST_Distance(d.location::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)`,
        'distance_meters',
      )
      .where('d.isOnline = true')
      .andWhere('d.isAvailable = true')
      .andWhere('d.location IS NOT NULL')
      .andWhere('d.locationUpdatedAt >= :ninetySecAgo', { ninetySecAgo })
      .andWhere(
        `ST_DWithin(d.location::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)`,
      )
      .setParameters({ lat, lng, radius: radiusMeters, ninetySecAgo })
      .orderBy('distance_meters', 'ASC')
      .limit(20);

    if (vehicleType) {
      qb.andWhere('d.vehicleType = :vehicleType', { vehicleType });
    }

    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((d, i) => {
      const [lngCoord, latCoord] = d.location!.coordinates;
      return this.toResult(d, parseFloat(raw[i].distance_meters), latCoord, lngCoord);
    });
  }

  private toResult(d: DriverEntity, distanceMeters: number, lat: number, lng: number): NearbyDriverResult {
    // Rough ETA assuming ~25 km/h average city driving speed.
    const etaMinutes = Math.max(1, Math.round((distanceMeters / 1000 / 25) * 60));
    return {
      driverId: d.id,
      userId: d.userId,
      name: d.user?.name ?? 'Driver',
      vehicleType: d.vehicleType,
      carModel: d.carModel,
      rating: Number(d.rating),
      distanceMeters: Math.round(distanceMeters),
      etaMinutes,
      lat,
      lng,
    };
  }
}
