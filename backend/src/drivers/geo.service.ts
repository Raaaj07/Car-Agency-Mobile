import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../config/redis.module';
import { VehicleType } from './entities/driver.entity';

const GEO_KEY_PREFIX = 'drivers:geo:'; // one geo-set per vehicle type, e.g. drivers:geo:sedan
const ALL_DRIVERS_GEO_KEY = 'drivers:geo:all';
const DRIVER_META_PREFIX = 'drivers:meta:'; // hash: vehicleType, isAvailable
// D-3: heartbeat score = last upsert (epoch ms). A driver with no heartbeat
// for DRIVER_FRESH_MS is dropped from the geo-sets by the cleanup job, so a
// crashed process can no longer leave a ghost driver behind forever.
const HEARTBEAT_KEY = 'drivers:heartbeat';
const DRIVER_FRESH_MS = 90_000; // matches the 90s locationUpdatedAt check in DriversService
const CLEANUP_INTERVAL_MS = 60_000;

export interface NearbyDriverHit {
  driverId: string;
  distanceMeters: number;
  lat: number;
  lng: number;
}

@Injectable()
export class GeoService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(GeoService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private geoKey(vehicleType: VehicleType) {
    return `${GEO_KEY_PREFIX}${vehicleType}`;
  }

  private freshCutoff(): number {
    return Date.now() - DRIVER_FRESH_MS;
  }

  async upsertDriverLocation(
    driverId: string,
    vehicleType: VehicleType,
    lat: number,
    lng: number,
  ): Promise<void> {
    const now = Date.now();
    await Promise.all([
      this.redis.geoadd(this.geoKey(vehicleType), lng, lat, driverId),
      this.redis.geoadd(ALL_DRIVERS_GEO_KEY, lng, lat, driverId),
      this.redis.hset(`${DRIVER_META_PREFIX}${driverId}`, { vehicleType }),
      // Heartbeat: keeps the ghost filter honest; meta TTL dies with the
      // process (a crash can't ZREM its own member — the cleanup job does).
      this.redis.zadd(HEARTBEAT_KEY, now, driverId),
      this.redis.expire(`${DRIVER_META_PREFIX}${driverId}`, Math.ceil(DRIVER_FRESH_MS / 1000)),
    ]);
  }

  async removeDriver(driverId: string, vehicleType: VehicleType): Promise<void> {
    await Promise.all([
      this.redis.zrem(this.geoKey(vehicleType), driverId),
      this.redis.zrem(ALL_DRIVERS_GEO_KEY, driverId),
      this.redis.del(`${DRIVER_META_PREFIX}${driverId}`),
      this.redis.zrem(HEARTBEAT_KEY, driverId),
    ]);
  }

  /**
   * GEOSEARCH within radiusMeters of (lat, lng), sorted nearest-first.
   * Members whose heartbeat is older than 90s are dropped (ghost filter) —
   * a crashed driver stays invisible even if the cleanup job hasn't run yet.
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

      if (raw.length === 0) return [];
      const freshIds = await this.redis.zrangebyscore(HEARTBEAT_KEY, this.freshCutoff(), '+inf');
      const fresh = new Set(freshIds);

      return raw
        .filter(([driverId]) => fresh.has(driverId))
        .map(([driverId, distance, coord]) => ({
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

  /** D-3: start the ghost-driver sweep once Redis wiring is ready. */
  onModuleInit(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => void this.sweepStaleDrivers(), CLEANUP_INTERVAL_MS);
    // Never hold the process open just for the sweep.
    this.cleanupTimer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * D-3: remove geo/meta/heartbeat entries for drivers that stopped
   * heartbeating > 90s ago (crashed process, hard kill, network split).
   * Best-effort: a failed sweep logs and retries on the next tick.
   */
  private async sweepStaleDrivers(): Promise<void> {
    try {
      const stale = await this.redis.zrangebyscore(HEARTBEAT_KEY, '-inf', this.freshCutoff());
      if (stale.length === 0) return;

      for (const driverId of stale) {
        const metaKey = `${DRIVER_META_PREFIX}${driverId}`;
        const vehicleType = await this.redis.hget(metaKey, 'vehicleType');
        const pipeline = this.redis.pipeline();
        pipeline.zrem(ALL_DRIVERS_GEO_KEY, driverId);
        if (vehicleType) pipeline.zrem(this.geoKey(vehicleType as VehicleType), driverId);
        pipeline.del(metaKey);
        pipeline.zrem(HEARTBEAT_KEY, driverId);
        await pipeline.exec();
      }
      this.logger.log(`Geo sweep removed ${stale.length} stale driver(s)`);
    } catch (err) {
      this.logger.warn(`Geo sweep failed: ${(err as Error).message}`);
    }
  }
}
