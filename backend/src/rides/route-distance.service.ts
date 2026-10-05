import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { haversineKm } from '../common/geo-utils';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * R-7: a real road route is ~1.3x the straight-line distance, so when routing
 * is unavailable (no token / API failure / timeout) the straight-line length
 * is multiplied by this before being used as an estimate.
 */
export const ROUTE_FALLBACK_FACTOR = 1.3;

const MAPBOX_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const CACHE_MAX_ENTRIES = 500;
const CACHE_ROUND_DP = 3; // ~110 m grid: neighbours share one cache entry

/**
 * Server-side routed distance (Mapbox Directions), used as the base for the
 * booking estimate (rides.create), the completion fare clamp
 * (routed x 1.25, hard cap 500 km) and the admin distance-outlier flag.
 *
 * Straight-line distance under-counts real roads, so clamping driver claims
 * against it flagged legitimate detours as inflated. Every call is guarded by
 * a 3 s timeout and falls back to `haversine x ROUTE_FALLBACK_FACTOR`, so fare
 * computation never blocks on an unreachable Mapbox. Results are cached for
 * 10 minutes keyed by rounded pickup/dropoff.
 */
@Injectable()
export class RouteDistanceService {
  private readonly logger = new Logger(RouteDistanceService.name);
  private readonly cache = new Map<string, { km: number; at: number }>();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Routed road distance in km (0 for identical/invalid points). */
  async routedKm(pickup: LatLng, dropoff: LatLng): Promise<number> {
    const straight = haversineKm(pickup, dropoff);
    if (!Number.isFinite(straight) || straight <= 0) return 0;

    const key = this.cacheKey(pickup, dropoff);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.km;

    const km = await this.fetchRoutedKm(pickup, dropoff, straight);
    this.cache.delete(key);
    this.cache.set(key, { km, at: Date.now() }); // re-insert => oldest-first order
    this.evict();
    return km;
  }

  private cacheKey(pickup: LatLng, dropoff: LatLng): string {
    const r = (n: number) => n.toFixed(CACHE_ROUND_DP);
    return `${r(pickup.lat)},${r(pickup.lng)}>${r(dropoff.lat)},${r(dropoff.lng)}`;
  }

  /** Drop expired entries, then cap the cache (insertion order = oldest first). */
  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.at >= CACHE_TTL_MS) this.cache.delete(key);
    }
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }

  private async fetchRoutedKm(pickup: LatLng, dropoff: LatLng, straight: number): Promise<number> {
    const fallback = straight * ROUTE_FALLBACK_FACTOR;
    const token = this.config.get<string>('MAPBOX_TOKEN');
    if (!token) return fallback; // not configured (common in dev) — no HTTP call

    const coords = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;
    type DirectionsResponse = { routes?: Array<{ distance?: number }> };
    try {
      const res = await firstValueFrom(
        this.http.get<DirectionsResponse>(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}`,
          {
            params: { access_token: token, overview: 'false', alternatives: 'false' },
            timeout: MAPBOX_TIMEOUT_MS,
          },
        ),
      );
      const meters = Number(res.data?.routes?.[0]?.distance);
      if (Number.isFinite(meters) && meters > 0) return meters / 1000;
      this.logger.warn('Mapbox Directions returned no usable route; using straight-line fallback');
      return fallback;
    } catch (err) {
      this.logger.warn(
        `Mapbox Directions failed (${(err as Error).message ?? 'unknown'}); using straight-line x${ROUTE_FALLBACK_FACTOR} fallback`,
      );
      return fallback;
    }
  }
}
