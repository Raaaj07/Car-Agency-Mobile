import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { REDIS_CLIENT } from '../config/redis.module';
import { DriverEntity, VehicleType } from './entities/driver.entity';
import { presenceGraceMs } from './presence';

const GEO_KEY_PREFIX = 'drivers:geo:'; // one geo-set per vehicle type, e.g. drivers:geo:sedan
const ALL_DRIVERS_GEO_KEY = 'drivers:geo:all';
const DRIVER_META_PREFIX = 'drivers:meta:'; // hash: vehicleType, isAvailable
// D-3: `driver:lastseen` ZSET (member = driverId, score = last upsert epoch-ms).
// A driver with no heartbeat for the presence grace window (default 15 min, see
// ./presence.ts; was a fixed 90 s) is dropped from the geo-sets by the cleanup
// job AND forced offline in Postgres, so a crashed process can no longer leave
// a ghost driver behind (in Redis or in the admin UI). A driver who is merely
// parked and resting stays visible inside the window.
const LASTSEEN_KEY = 'driver:lastseen';
// Pre-rename key from before Task 6 — deleted on boot so it can't linger.
const LEGACY_HEARTBEAT_KEY = 'drivers:heartbeat';
// D-3: sweep every 30 s so a ghost disappears within ~30 s of the grace window
// ending (staleness + worst-case tick).
const CLEANUP_INTERVAL_MS = 30_000;

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
  private staleSweepInFlight = false;
  // How long a driver may stay silent and still count as present (./presence.ts).
  private readonly freshMs: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(DriverEntity) private readonly driversRepo: Repository<DriverEntity>,
    // Optional so unit tests (and scripts) get the default grace window.
    @Optional() config?: ConfigService,
  ) {
    this.freshMs = presenceGraceMs(config?.get('DRIVER_PRESENCE_GRACE_SECONDS'));
  }

  private geoKey(vehicleType: VehicleType) {
    return `${GEO_KEY_PREFIX}${vehicleType}`;
  }

  private freshCutoff(): number {
    return Date.now() - this.freshMs;
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
      // Last-seen heartbeat: keeps the ghost filter honest; meta TTL dies
      // with the process (a crash can't ZREM its own member — the sweep does).
      this.redis.zadd(LASTSEEN_KEY, now, driverId),
      this.redis.expire(`${DRIVER_META_PREFIX}${driverId}`, Math.ceil(this.freshMs / 1000)),
    ]);
  }

  async removeDriver(driverId: string, vehicleType: VehicleType): Promise<void> {
    await Promise.all([
      this.redis.zrem(this.geoKey(vehicleType), driverId),
      this.redis.zrem(ALL_DRIVERS_GEO_KEY, driverId),
      this.redis.del(`${DRIVER_META_PREFIX}${driverId}`),
      this.redis.zrem(LASTSEEN_KEY, driverId),
    ]);
  }

  /**
   * GEOSEARCH within radiusMeters of (lat, lng), sorted nearest-first.
   * Members whose last-seen heartbeat is older than 90s are dropped (ghost
   * filter) — a crashed driver stays invisible even if the cleanup job
   * hasn't run yet. Returns [] if the key doesn't exist yet or ioredis errors
   * (e.g. Redis version < 6.2 without GEOSEARCH) so callers can fall back.
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
      const freshIds = await this.redis.zrangebyscore(LASTSEEN_KEY, this.freshCutoff(), '+inf');
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
    // Drop the pre-rename heartbeat key (no TTL, would linger forever).
    void this.redis.del(LEGACY_HEARTBEAT_KEY).catch((err: Error) => {
      this.logger.warn(`Legacy heartbeat key cleanup failed: ${err.message}`);
    });
    this.cleanupTimer = setInterval(() => void this.sweepStaleDrivers(), CLEANUP_INTERVAL_MS);
    // Never hold the process open just for the sweep.
    this.cleanupTimer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * D-3: remove geo/meta/last-seen entries for drivers that stopped
   * heartbeating > 90s ago (crashed process, hard kill, network split) and
   * force them offline in Postgres so admin/riders stop seeing them as an
   * online driver. Redis first (the ghost must go even if the DB is down),
   * then the Postgres write in its own try — both best-effort, retried on the
   * next 30 s tick.
   */
  private async sweepStaleDrivers(): Promise<void> {
    if (this.staleSweepInFlight) return;
    this.staleSweepInFlight = true;
    try {
      const stale = await this.redis.zrangebyscore(LASTSEEN_KEY, '-inf', this.freshCutoff());
      if (stale.length === 0) return;

      for (const driverId of stale) {
        const metaKey = `${DRIVER_META_PREFIX}${driverId}`;
        const vehicleType = await this.redis.hget(metaKey, 'vehicleType');
        const pipeline = this.redis.pipeline();
        pipeline.zrem(ALL_DRIVERS_GEO_KEY, driverId);
        if (vehicleType) pipeline.zrem(this.geoKey(vehicleType as VehicleType), driverId);
        pipeline.del(metaKey);
        pipeline.zrem(LASTSEEN_KEY, driverId);
        await pipeline.exec();
      }
      this.logger.log(`Geo sweep removed ${stale.length} stale driver(s)`);

      try {
        // Conditional: only rows still flagged online/available are touched,
        // so a sweep never churns drivers who already went offline cleanly.
        await this.driversRepo.update(
          { id: In(stale), isOnline: true },
          { isOnline: false, isAvailable: false },
        );
        await this.driversRepo.update(
          { id: In(stale), isAvailable: true },
          { isAvailable: false },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to force ${stale.length} stale driver(s) offline in Postgres: ${(err as Error).message}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Geo sweep failed: ${(err as Error).message}`);
    } finally {
      this.staleSweepInFlight = false;
    }
  }
}
