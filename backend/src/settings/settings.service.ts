import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from './entities/app-setting.entity';

export const DRIVER_RADIUS_KEY = 'driver_search_radius_m';
/** Smallest / largest radius an admin may configure (metres). */
export const MIN_RADIUS_M = 1_000;
export const MAX_RADIUS_M = 50_000;
/** Used until an admin saves a value (10 km). */
export const DEFAULT_RADIUS_M = 10_000;
/**
 * In-process cache lifetime. A change made by an admin is visible on this
 * instance immediately (the cache is overwritten on save) and on other
 * instances within this many ms.
 */
const CACHE_TTL_MS = 15_000;

export interface DriverRadiusSetting {
  radiusMeters: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * Runtime settings the admin can change without a redeploy. The driver
 * search radius is the one place both the rider's "nearby drivers" view and
 * ride matching read from, so they can never disagree.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: { value: DriverRadiusSetting; at: number } | null = null;

  constructor(@InjectRepository(AppSettingEntity) private readonly repo: Repository<AppSettingEntity>) {}

  /** Round + range-check a metre value; null when it is not usable. */
  static parseRadius(raw: unknown): number | null {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (rounded < MIN_RADIUS_M || rounded > MAX_RADIUS_M) return null;
    return rounded;
  }

  /** Current radius in metres (cached; falls back to the default on any DB problem). */
  async getSearchRadiusMeters(): Promise<number> {
    return (await this.getDriverRadius()).radiusMeters;
  }

  async getDriverRadius(): Promise<DriverRadiusSetting> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    let value: DriverRadiusSetting = { radiusMeters: DEFAULT_RADIUS_M, updatedAt: null, updatedBy: null };
    try {
      const row = await this.repo.findOne({ where: { key: DRIVER_RADIUS_KEY } });
      const parsed = row ? SettingsService.parseRadius(row.value) : null;
      if (row && parsed !== null) {
        value = { radiusMeters: parsed, updatedAt: row.updatedAt ?? null, updatedBy: row.updatedBy ?? null };
      }
    } catch (err) {
      // Matching must keep working if the settings table is unreachable or
      // not migrated yet: serve the last good value, else the default.
      this.logger.warn(`Could not read driver radius setting: ${(err as Error).message}`);
      if (this.cache) return this.cache.value;
    }
    this.cache = { value, at: now };
    return value;
  }

  /** Persist a new radius (metres). Throws 400 outside [MIN_RADIUS_M, MAX_RADIUS_M]. */
  async setSearchRadiusMeters(meters: number, actorUserId: string | null): Promise<DriverRadiusSetting> {
    const radius = SettingsService.parseRadius(meters);
    if (radius === null) {
      throw new BadRequestException(
        `Radius must be between ${MIN_RADIUS_M / 1000} km and ${MAX_RADIUS_M / 1000} km`,
      );
    }
    await this.repo.save(
      this.repo.create({ key: DRIVER_RADIUS_KEY, value: String(radius), updatedBy: actorUserId }),
    );
    const value: DriverRadiusSetting = { radiusMeters: radius, updatedAt: new Date(), updatedBy: actorUserId };
    this.cache = { value, at: Date.now() };
    return value;
  }
}
