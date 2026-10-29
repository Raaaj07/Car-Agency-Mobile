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

export const OFFER_TIMEOUT_KEY = 'ride_offer_timeout_s';
/** Smallest / largest time (seconds) a driver may be given to answer an offer. */
export const MIN_OFFER_TIMEOUT_S = 10;
export const MAX_OFFER_TIMEOUT_S = 60;
/** Used until an admin saves a value, when RIDE_REQUEST_TIMEOUT_SECONDS is not set either. */
export const DEFAULT_OFFER_TIMEOUT_S = 15;

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

export interface OfferTimeoutSetting {
  seconds: number;
  /** true while no admin value is stored (the env / built-in default applies). */
  isDefault: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * The offer timeout used when an admin has not saved one: the
 * RIDE_REQUEST_TIMEOUT_SECONDS env value (kept working exactly as before),
 * else 15 s.
 */
export function offerTimeoutFromEnv(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_OFFER_TIMEOUT_S;
}

interface RawSetting {
  value: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * Runtime settings the admin can change without a redeploy. The driver
 * search radius is the one place both the rider's "nearby drivers" view and
 * ride matching read from, so they can never disagree; the offer timeout is
 * how long each driver has to answer a ride offer.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  // One cache entry per setting key (15 s).
  private readonly cache = new Map<string, { value: RawSetting; at: number }>();

  constructor(@InjectRepository(AppSettingEntity) private readonly repo: Repository<AppSettingEntity>) {}

  /** Round + range-check a metre value; null when it is not usable. */
  static parseRadius(raw: unknown): number | null {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (rounded < MIN_RADIUS_M || rounded > MAX_RADIUS_M) return null;
    return rounded;
  }

  /** Round + range-check a seconds value; null when it is not usable. */
  static parseOfferTimeout(raw: unknown): number | null {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (rounded < MIN_OFFER_TIMEOUT_S || rounded > MAX_OFFER_TIMEOUT_S) return null;
    return rounded;
  }

  /** Cached read of one key; never throws (a DB problem serves the last good value, else "unset"). */
  private async readRaw(key: string): Promise<RawSetting> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
    let value: RawSetting = { value: null, updatedAt: null, updatedBy: null };
    try {
      const row = await this.repo.findOne({ where: { key } });
      if (row) {
        value = { value: row.value, updatedAt: row.updatedAt ?? null, updatedBy: row.updatedBy ?? null };
      }
    } catch (err) {
      // Matching must keep working if the settings table is unreachable or
      // not migrated yet: serve the last good value, else the default.
      this.logger.warn(`Could not read setting ${key}: ${(err as Error).message}`);
      if (hit) return hit.value;
    }
    this.cache.set(key, { value, at: now });
    return value;
  }

  private async writeRaw(key: string, value: string, actorUserId: string | null): Promise<RawSetting> {
    await this.repo.save(this.repo.create({ key, value, updatedBy: actorUserId }));
    const saved: RawSetting = { value, updatedAt: new Date(), updatedBy: actorUserId };
    this.cache.set(key, { value: saved, at: Date.now() });
    return saved;
  }

  // ── Driver search radius ────────────────────────────────────────────────

  /** Current radius in metres (cached; falls back to the default on any DB problem). */
  async getSearchRadiusMeters(): Promise<number> {
    return (await this.getDriverRadius()).radiusMeters;
  }

  async getDriverRadius(): Promise<DriverRadiusSetting> {
    const raw = await this.readRaw(DRIVER_RADIUS_KEY);
    const parsed = raw.value !== null ? SettingsService.parseRadius(raw.value) : null;
    if (parsed !== null) {
      return { radiusMeters: parsed, updatedAt: raw.updatedAt, updatedBy: raw.updatedBy };
    }
    return { radiusMeters: DEFAULT_RADIUS_M, updatedAt: null, updatedBy: null };
  }

  /** Persist a new radius (metres). Throws 400 outside [MIN_RADIUS_M, MAX_RADIUS_M]. */
  async setSearchRadiusMeters(meters: number, actorUserId: string | null): Promise<DriverRadiusSetting> {
    const radius = SettingsService.parseRadius(meters);
    if (radius === null) {
      throw new BadRequestException(
        `Radius must be between ${MIN_RADIUS_M / 1000} km and ${MAX_RADIUS_M / 1000} km`,
      );
    }
    const saved = await this.writeRaw(DRIVER_RADIUS_KEY, String(radius), actorUserId);
    return { radiusMeters: radius, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
  }

  // ── Offer timeout ───────────────────────────────────────────────────────

  /**
   * How long a driver has to answer an offer. `fallbackSeconds` is what applies
   * until an admin saves a value (callers pass the env-derived default).
   */
  async getOfferTimeout(fallbackSeconds: number = DEFAULT_OFFER_TIMEOUT_S): Promise<OfferTimeoutSetting> {
    const raw = await this.readRaw(OFFER_TIMEOUT_KEY);
    const parsed = raw.value !== null ? SettingsService.parseOfferTimeout(raw.value) : null;
    if (parsed !== null) {
      return { seconds: parsed, isDefault: false, updatedAt: raw.updatedAt, updatedBy: raw.updatedBy };
    }
    return { seconds: fallbackSeconds, isDefault: true, updatedAt: null, updatedBy: null };
  }

  async getOfferTimeoutSeconds(fallbackSeconds: number = DEFAULT_OFFER_TIMEOUT_S): Promise<number> {
    return (await this.getOfferTimeout(fallbackSeconds)).seconds;
  }

  /** Persist a new offer timeout. Throws 400 outside [MIN_OFFER_TIMEOUT_S, MAX_OFFER_TIMEOUT_S]. */
  async setOfferTimeoutSeconds(seconds: number, actorUserId: string | null): Promise<OfferTimeoutSetting> {
    const value = SettingsService.parseOfferTimeout(seconds);
    if (value === null) {
      throw new BadRequestException(
        `Offer timeout must be between ${MIN_OFFER_TIMEOUT_S} and ${MAX_OFFER_TIMEOUT_S} seconds`,
      );
    }
    const saved = await this.writeRaw(OFFER_TIMEOUT_KEY, String(value), actorUserId);
    return { seconds: value, isDefault: false, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
  }
}
