import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedPlaceEntity } from './entities/saved-place.entity';
import { UpsertSavedPlaceDto } from './dto/upsert-saved-place.dto';
import { PlaceItemDto, SavedPlaceDto } from './dto/place-item.dto';
import { RideEntity } from '../rides/entities/ride.entity';
import { haversineKm } from '../common/geo-utils';
import { PLACES_CONFIG, PlaceConfigItem } from './places.config';
import {
  DEFAULT_NEAR_RADIUS_M,
  GooglePlacesService,
  MAX_SEARCH_RADIUS_M,
  NearbyPlaceHit,
} from './google-places.service';

function makeGeoKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// Every curated spot (for recent-dropoff photo matching).
const CURATED_PLACES: PlaceConfigItem[] = [
  ...PLACES_CONFIG.quickPicks,
  ...PLACES_CONFIG.popular,
  ...PLACES_CONFIG.cityHighlights,
];

// ── "Near You" ──────────────────────────────────────────────────────────────
// The nearest places within a few kilometres of the rider.
const NEAR_MIN_RADIUS_M = 1_000;
const NEAR_MAX_RADIUS_M = 10_000;
const NEARBY_MAX_ITEMS = 10;

// ── "Popular" ───────────────────────────────────────────────────────────────
// Live, well-rated Google places within 50 km, nearest first.
const POPULAR_RADIUS_M = MAX_SEARCH_RADIUS_M;
const POPULAR_MIN_RATING = 4.0;
const POPULAR_MIN_RATING_COUNT = 25;
const POPULAR_MAX_ITEMS = 20;
// Curated (Salem) spots are shown only when the rider is actually near them
// (25 km), so someone in Erode (~50-100 km away) never sees Salem landmarks.
// Live Google results use the full 50 km radius; this limit is for curated only.
const CURATED_MAX_KM = 25;
// A curated spot this close to a live result is the same place — keep the live one.
const DUPLICATE_KM = 0.2;

/** Straight-line distance rounded to 0.1 km (what the app displays). */
function distanceKmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.round(haversineKm(a, b) * 10) / 10;
}

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  constructor(
    @InjectRepository(SavedPlaceEntity)
    private readonly savedPlaces: Repository<SavedPlaceEntity>,
    @InjectRepository(RideEntity)
    private readonly rides: Repository<RideEntity>,
    private readonly google: GooglePlacesService,
  ) {}

  /**
   * Photo URL for a curated place. ALWAYS the backend proxy path — the proxy
   * (PlaceImageService) tries Google, then the curated Wikimedia URL, then a
   * Wikimedia search, and downloads the bytes server-side. The phone never
   * talks to Google/Wikimedia directly, so User-Agent blocks, bad hotlinks and
   * key restrictions can no longer leave the card blank.
   */
  private buildImageUrl(item: PlaceConfigItem): string {
    return this.photoUrl(`/places/photo/${encodeURIComponent(item.id)}`);
  }

  /**
   * Photo URL for a live Google place: the same backend proxy (Google photo
   * first, Wikimedia backup). Never a direct Google/Wikimedia link.
   */
  private buildLiveImageUrl(googlePlaceId: string): string {
    return this.photoUrl(`/places/photo/g/${encodeURIComponent(googlePlaceId)}`);
  }

  /**
   * Returns a path RELATIVE to the API base (e.g. /places/photo/pop-kottai).
   * The app prefixes it with its own EXPO_PUBLIC_API_URL (which already
   * contains /api/v1). Do NOT prefix PUBLIC_API_URL here: it usually lacks the
   * global /api/v1 prefix, which made every proxied photo URL a 404.
   */
  private photoUrl(path: string): string {
    return path;
  }

  /** A live Google hit as an app card. Same id for Near You and Popular so the app can de-duplicate. */
  private liveItem(h: NearbyPlaceHit, ref: { lat: number; lng: number }): PlaceItemDto {
    return {
      id: `g-${h.googlePlaceId}`,
      title: h.title,
      subtitle: h.subtitle,
      lat: h.lat,
      lng: h.lng,
      imageUrl: this.buildLiveImageUrl(h.googlePlaceId),
      distanceKm: distanceKmBetween(ref, h),
      rating: h.rating,
      ratingCount: h.ratingCount,
    };
  }

  /**
   * "Near You": the NEAREST places within a few kilometres of the rider's
   * CURRENT location (default 5 km, at most 10 km), nearest first, each with
   * `distanceKm`. When Google has nothing (missing key / outage) it falls
   * back to curated spots within the same radius — so curated Salem places
   * only ever appear for a rider who is actually near them.
   */
  async getNearby(lat: number, lng: number, radiusM?: number): Promise<PlaceItemDto[]> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const ref = { lat, lng };
    const radius = Math.min(
      Math.max(radiusM ?? DEFAULT_NEAR_RADIUS_M, NEAR_MIN_RADIUS_M),
      NEAR_MAX_RADIUS_M,
    );
    const hits = await this.google.searchNearbyByDistance(lat, lng, radius);
    this.logger.log(`Near You (${lat.toFixed(3)},${lng.toFixed(3)}, ${radius} m): ${hits.length} Google places`);
    if (hits.length === 0) return this.curatedWithin(ref, radius / 1000, NEARBY_MAX_ITEMS);
    return hits
      .map((h) => this.liveItem(h, ref))
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      .slice(0, NEARBY_MAX_ITEMS);
  }

  /** Curated places within `maxKm` of `ref`, nearest first, de-duplicated. */
  private curatedWithin(
    ref: { lat: number; lng: number },
    maxKm: number,
    limit: number,
    source: PlaceConfigItem[] = CURATED_PLACES,
  ): PlaceItemDto[] {
    const seen = new Set<string>();
    return source
      .filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .map((item) => ({ item, km: haversineKm(ref, item) }))
      .filter((x) => x.km <= maxKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, limit)
      .map(({ item, km }) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        lat: item.lat,
        lng: item.lng,
        imageUrl: this.buildImageUrl(item),
        distanceKm: Math.round(km * 10) / 10,
      }));
  }

  async getSaved(userId: string): Promise<SavedPlaceDto[]> {
    const places = await this.savedPlaces.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return places.map((p) => ({
      id: p.id,
      label: p.label,
      title: p.title,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
    }));
  }

  async upsertSaved(userId: string, dto: UpsertSavedPlaceDto): Promise<SavedPlaceDto> {
    const geoKey = makeGeoKey(dto.lat, dto.lng);

    // If a label (home/work) is being set, remove the previous entry with that label for this user.
    if (dto.label) {
      await this.savedPlaces.delete({ userId, label: dto.label });
    }

    // Upsert by (userId, geoKey).
    const existing = await this.savedPlaces.findOne({ where: { userId, geoKey } });
    if (existing) {
      existing.title = dto.title;
      existing.address = dto.address;
      if (dto.label !== undefined) existing.label = dto.label ?? null;
      const saved = await this.savedPlaces.save(existing);
      return { id: saved.id, label: saved.label, title: saved.title, address: saved.address, lat: saved.lat, lng: saved.lng };
    }

    const entity = this.savedPlaces.create({
      userId,
      title: dto.title,
      address: dto.address,
      lat: dto.lat,
      lng: dto.lng,
      geoKey,
      label: dto.label ?? null,
    });
    const saved = await this.savedPlaces.save(entity);
    return { id: saved.id, label: saved.label, title: saved.title, address: saved.address, lat: saved.lat, lng: saved.lng };
  }

  async deleteSaved(userId: string, id: string): Promise<void> {
    const place = await this.savedPlaces.findOne({ where: { id } });
    if (!place || place.userId !== userId) throw new NotFoundException('Saved place not found');
    await this.savedPlaces.delete({ id });
  }

  async getRecent(userId: string, limit = 5): Promise<PlaceItemDto[]> {
    const clampedLimit = Math.min(Math.max(1, limit), 10);
    // Distinct dropoff by geoKey (lat/lng rounded to 4 decimals), newest first.
    // Exclude system-cancelled rides.
    const rows = await this.rides.query(
      `SELECT DISTINCT ON (geo_key) geo_key, title, addr, lat, lng, created_at
       FROM (
         SELECT
           round(CAST((r.dropoff->>'lat') AS numeric), 4)::text || ',' || round(CAST((r.dropoff->>'lng') AS numeric), 4)::text AS geo_key,
           r.dropoff->>'address' AS addr,
           split_part(r.dropoff->>'address', ',', 1) AS title,
           CAST(r.dropoff->>'lat' AS double precision) AS lat,
           CAST(r.dropoff->>'lng' AS double precision) AS lng,
           r."createdAt" AS created_at
         FROM rides r
         WHERE r."riderId" = $1
           AND NOT (r.status = 'cancelled' AND r."cancelledBy" = 'system')
           AND r.dropoff IS NOT NULL
       ) sub
       ORDER BY geo_key, created_at DESC
       LIMIT $2`,
      [userId, clampedLimit * 3],
    ) as Array<{ geo_key: string; title: string; addr: string; lat: number; lng: number; created_at: Date }>;

    // Sort by most recent and take top N.
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const topRows = rows.slice(0, clampedLimit);

    // Lookup saved status.
    const geoKeys = topRows.map((r) => r.geo_key);
    const saved = geoKeys.length > 0
      ? await this.savedPlaces.createQueryBuilder('sp')
          .where('sp.userId = :userId AND sp.geoKey IN (:...keys)', { userId, keys: geoKeys })
          .getMany()
      : [];
    const savedMap = new Map(saved.map((s) => [s.geoKey, s]));

    return topRows.length === 0 ? [] : await Promise.all(
      topRows.map(async (r) => {
        const sp = savedMap.get(r.geo_key);
        const coords = { lat: Number(r.lat), lng: Number(r.lng) };
        // A dropoff at a curated spot reuses that spot's photo.
        const near = CURATED_PLACES.find(
          (c) => haversineKm(coords, { lat: c.lat, lng: c.lng }) < 0.1,
        );
        return {
          id: `recent-${r.geo_key}`,
          title: r.title || r.addr,
          subtitle: r.addr,
          lat: coords.lat,
          lng: coords.lng,
          imageUrl: near ? this.buildImageUrl(near) : null,
          saved: !!sp,
          savedId: sp?.id ?? null,
        };
      }),
    );
  }

  /**
   * Home-screen suggestion lists.
   *
   * With a location (the normal case):
   *  - `popular`: LIVE Google places ranked by popularity, kept only when
   *    well rated (>= 4.0 stars from >= 25 ratings), within 50 km, merged
   *    with any curated popular spot within 25 km, NEAREST FIRST.
   *  - `quickPicks` / `cityHighlights`: curated spots, but ONLY those within
   *    25 km of the rider (a rider in Erode gets no Salem landmarks).
   *
   * Without a location there is nothing to be "near", so the curated lists
   * are returned unfiltered (legacy behaviour for callers that send no
   * coordinates).
   */
  async getPopular(lat?: number, lng?: number): Promise<{
    quickPicks: PlaceItemDto[];
    popular: PlaceItemDto[];
    cityHighlights: PlaceItemDto[];
  }> {
    const ref =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

    if (!ref) {
      const plain = (items: PlaceConfigItem[]): PlaceItemDto[] =>
        items.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          lat: item.lat,
          lng: item.lng,
          imageUrl: this.buildImageUrl(item),
        }));
      return {
        quickPicks: plain(PLACES_CONFIG.quickPicks),
        popular: plain(PLACES_CONFIG.popular),
        cityHighlights: plain(PLACES_CONFIG.cityHighlights),
      };
    }

    const hits = await this.google.searchNearbyByPopularity(ref.lat, ref.lng, POPULAR_RADIUS_M);
    this.logger.log(
      `Popular (${ref.lat.toFixed(3)},${ref.lng.toFixed(3)}): ${hits.length} Google places`,
    );
    const live = hits
      .filter(
        (h) =>
          h.rating !== null &&
          h.rating >= POPULAR_MIN_RATING &&
          (h.ratingCount ?? 0) >= POPULAR_MIN_RATING_COUNT,
      )
      .map((h) => this.liveItem(h, ref));

    // Curated popular spots near the rider that Google did not already return.
    const curatedPopular = this.curatedWithin(
      ref,
      CURATED_MAX_KM,
      POPULAR_MAX_ITEMS,
      PLACES_CONFIG.popular,
    ).filter(
      (c) => !live.some((l) => haversineKm({ lat: c.lat, lng: c.lng }, { lat: l.lat, lng: l.lng }) < DUPLICATE_KM),
    );

    const popular = [...live, ...curatedPopular]
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      .slice(0, POPULAR_MAX_ITEMS);

    return {
      quickPicks: this.curatedWithin(ref, CURATED_MAX_KM, PLACES_CONFIG.quickPicks.length, PLACES_CONFIG.quickPicks),
      popular,
      cityHighlights: this.curatedWithin(
        ref,
        CURATED_MAX_KM,
        PLACES_CONFIG.cityHighlights.length,
        PLACES_CONFIG.cityHighlights,
      ),
    };
  }
}