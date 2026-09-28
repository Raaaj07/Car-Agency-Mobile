import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriverEntity, VehicleType } from './entities/driver.entity';
import { GeoService, NearbyDriverHit } from './geo.service';
import { RideEntity } from '../rides/entities/ride.entity';

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
    ) {
      this.defaultRadiusMeters = this.config.get<number>('DRIVER_SEARCH_RADIUS_METERS') ?? 5000;
    }


  // Creates or updates the driver profile (vehicle/plate) for a user who
  // picked "driver" on RoleSelectionScreen. Idempotent by userId.
  async registerOrUpdate(
    userId: string,
    data: { vehicleType: VehicleType; carModel: string; plateNumber: string },
  ): Promise<DriverEntity> {
    let driver = await this.drivers.findOne({ where: { userId } });
    if (!driver) {
      driver = this.drivers.create({ userId, isOnline: false, isAvailable: false });
    }
    driver.vehicleType = data.vehicleType;
    driver.carModel = data.carModel;
    driver.plateNumber = data.plateNumber;
    return this.drivers.save(driver);
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
  // rolls the new rating into the driver's running average.
  async applyRating(driverId: string, newRating: number): Promise<void> {
    const driver = await this.findById(driverId);
    const currentAvg = Number(driver.rating);
    const n = driver.totalTrips;
    const updatedAvg = n === 0 ? newRating : (currentAvg * n + newRating) / (n + 1);
    await this.drivers.update({ id: driverId }, { rating: updatedAvg.toFixed(2), totalTrips: n + 1 });
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

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { sum, count } = await this.rides
    .createQueryBuilder('ride')
    .select(`COALESCE(SUM((ride."fareBreakdown"->>'total')::numeric), 0)`, 'sum')
    .addSelect('COUNT(*)', 'count')
    .where('ride.driverId = :driverId', { driverId: driver.id })
    .andWhere('ride.status = :status', { status: 'completed' })
    .andWhere('ride.completedAt >= :start', { start: startOfToday })
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
  };
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
    const radius = radiusMeters ?? this.defaultRadiusMeters;
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
    const ids = hits.map((h) => h.driverId);
    const rows = await this.drivers.find({
      where: ids.map((id) => ({ id })),
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
