import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.module';
import { VehicleType } from './entities/driver.entity';

const GEO_KEY_PREFIX = 'drivers:geo:'; // one geo-set per vehicle type, e.g. drivers:geo:sedan
const ALL_DRIVERS_GEO_KEY = 'drivers:geo:all';
const DRIVER_META_PREFIX = 'drivers:meta:'; // hash: vehicleType, isAvailable

export interface NearbyDriverHit {
  driverId: string;
  distanceMeters: number;
  lat: number;
  lng: number;
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private geoKey(vehicleType: VehicleType) {
    return `${GEO_KEY_PREFIX}${vehicleType}`;
  }

  async upsertDriverLocation(
    driverId: string,
    vehicleType: VehicleType,
    lat: number,
    lng: number,
  ): Promise<void> {
    await Promise.all([
      this.redis.geoadd(this.geoKey(vehicleType), lng, lat, driverId),
      this.redis.geoadd(ALL_DRIVERS_GEO_KEY, lng, lat, driverId),
      this.redis.hset(`${DRIVER_META_PREFIX}${driverId}`, { vehicleType }),
    ]);
  }

  async removeDriver(driverId: string, vehicleType: VehicleType): Promise<void> {
    await Promise.all([
      this.redis.zrem(this.geoKey(vehicleType), driverId),
      this.redis.zrem(ALL_DRIVERS_GEO_KEY, driverId),
      this.redis.del(`${DRIVER_META_PREFIX}${driverId}`),
    ]);
  }

  /**
   * GEOSEARCH within radiusMeters of (lat, lng), sorted nearest-first.
   * Returns [] if the key doesn't exist yet or ioredis errors (e.g. Redis
   * version < 6.2 without GEOSEARCH) so callers can fall back to PostGIS.
   */
  async searchNearby(
    lat: number,
    lng: number,
    radiusMeters: number,
    vehicleType?: VehicleType,
    limit = 20,
  ): Promise<NearbyDriverHit[]> {
    const key = vehicleType ? this.geoKey(vehicleType) : ALL_DRIVERS_GEO_KEY;
    try {
      const raw = (await this.redis.call(
        'GEOSEARCH',
        key,
        'FROMLONLAT',
        lng,
        lat,
        'BYRADIUS',
        radiusMeters,
        'm',
        'ASC',
        'COUNT',
        limit,
        'WITHCOORD',
        'WITHDIST',
      )) as [string, string, [string, string]][];

      return raw.map(([driverId, distance, coord]) => ({
        driverId,
        distanceMeters: parseFloat(distance),
        lng: parseFloat(coord[0]),
        lat: parseFloat(coord[1]),
      }));
    } catch (err) {
      this.logger.warn(`GEOSEARCH failed, falling back to PostGIS: ${(err as Error).message}`);
      return [];
    }
  }
}
