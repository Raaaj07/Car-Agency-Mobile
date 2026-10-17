import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedPlaceEntity } from './entities/saved-place.entity';
import { UpsertSavedPlaceDto } from './dto/upsert-saved-place.dto';
import { PlaceItemDto, SavedPlaceDto } from './dto/place-item.dto';
import { RideEntity } from '../rides/entities/ride.entity';
import { haversineKm } from '../common/geo-utils';
import {
  DEFAULT_NEAR_RADIUS_M,
  GooglePlacesService,
  NearbyPlaceHit,
} from './google-places.service';
import { WIKI_MAX_RADIUS_M, WikiPlaceHit, WikipediaPlacesService } from './wikipedia-places.service';

function makeGeoKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// ── "Nearest places" ────────────────────────────────────────────────────────
// Live places within a few kilometres of the rider, nearest first. Nothing in
// this file is a fixed list of places: every item comes from Google Places,
// Wikipedia, or the rider's own ride history.
const NEAR_MIN_RADIUS_M = 1_000;
const NEAR_MAX_RADIUS_M = 10_000;
const NEARBY_MAX_ITEMS = 10;
// A place this close to another result is the same place — keep the first.
const DUPLICATE_KM = 0.2;
// When Google returns fewer than this many places WITH a photo (no key, quota,
// outage, or a small town), the list is topped up from Wikipedia so the home
// screen is not left empty.
const MIN_LIVE_RESULTS = 6;

// ── "Big places" (bus stands, railway stations, colleges) ───────────────────
const BIG_RADIUS_M = 10_000;
const BIG_MAX_ITEMS = 9;
// At most this many of each kind, so one kind (say 6 colleges) cannot crowd out
// the bus stand and the railway station.
const BIG_PER_KIND = 3;
// Wikipedia top-up only counts as a "big place" when its name says so.
const BIG_WORDS = /(bus (stand|station|terminus|stop)|railway|junction|station|college|university|institute|polytechnic)/i;
// Below this many results the list is topped up from Wikipedia.
const BIG_MIN_RESULTS = 6;

// ── "Popular places" ────────────────────────────────────────────────────────
const POPULAR_RADIUS_M = 25_000;
const POPULAR_MIN_RATING = 3.8;
const POPULAR_MIN_RATING_COUNT = 10;
const POPULAR_MAX_ITEMS = 12;
// Below this many results the list is topped up from Wikipedia sights.
const POPULAR_MIN_RESULTS = 8;

// ── "Frequently visited" ────────────────────────────────────────────────────
// A drop-off only counts as "frequent" once the rider has been there this
// many times; otherwise it is just a recent trip (shown under recents).
const FREQUENT_MIN_VISITS = 2;
const FREQUENT_MAX_ITEMS = 10;

const byDistance = (a: PlaceItemDto, b: PlaceItemDto): number =>
  (a.distanceKm ?? 0) - (b.distanceKm ?? 0);

const normTitle = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Real WGS84 pair: rejects NaN/Infinity and out-of-range values before any Google call. */
const isValidCoord = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

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
    // Optional so unit tests (and deployments) without it still work.
    @Optional() private readonly wiki?: WikipediaPlacesService,
  ) {}

  /**
   * Photo URL for a live Google place: the backend proxy (Google photo first,
   * Wikimedia backup). Returned as a path RELATIVE to the API base — the app
   * prefixes it with its own EXPO_PUBLIC_API_URL (which already contains
   * /api/v1).
   */
  private buildLiveImageUrl(googlePlaceId: string): string {
    return `/places/photo/g/${encodeURIComponent(googlePlaceId)}`;
  }

  /** A live Google hit as an app card. */
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

  /** A Wikipedia hit as an app card. Its photo is served by /places/photo/w/:pageId. */
  private wikiItem(h: WikiPlaceHit, ref: { lat: number; lng: number }): PlaceItemDto {
    return {
      id: `w-${h.pageId}`,
      title: h.title,
      subtitle: h.description,
      lat: h.lat,
      lng: h.lng,
      imageUrl: `/places/photo/w/${encodeURIComponent(h.pageId)}`,
      distanceKm: distanceKmBetween(ref, h),
      rating: null,
      ratingCount: null,
    };
  }

  /** Nearby Wikipedia places (every one has a photo), nearest first. Never throws. */
  private async wikiNearby(
    ref: { lat: number; lng: number },
    radiusM: number,
    limit: number,
    keep: (h: WikiPlaceHit) => boolean = () => true,
  ): Promise<PlaceItemDto[]> {
    if (!this.wiki) return [];
    try {
      const hits = await this.wiki.searchNearby(ref.lat, ref.lng, Math.min(radiusM, WIKI_MAX_RADIUS_M));
      return hits
        .filter(keep)
        .map((h) => this.wikiItem(h, ref))
        .sort(byDistance)
        .slice(0, limit);
    } catch (err) {
      this.logger.warn(`Wikipedia places failed: ${(err as Error)?.message ?? err}`);
      return [];
    }
  }

  /** `extra` items that are not the same place as anything already in `primary`. */
  private mergeUnique(primary: PlaceItemDto[], extra: PlaceItemDto[]): PlaceItemDto[] {
    const titles = new Set(primary.map((p) => normTitle(p.title)));
    const added = extra.filter(
      (e) =>
        !titles.has(normTitle(e.title)) &&
        !primary.some((p) => haversineKm({ lat: e.lat, lng: e.lng }, { lat: p.lat, lng: p.lng }) < DUPLICATE_KM),
    );
    return [...primary, ...added];
  }

  /**
   * "Nearest places": the closest places with a photo around the rider's
   * CURRENT location (default 5 km, at most 10 km), nearest first, each with
   * `distanceKm`. Google first, topped up from Wikipedia. There is NO fixed
   * fallback list: when neither source has anything the answer is [].
   */
  async getNearby(lat: number, lng: number, radiusM?: number): Promise<PlaceItemDto[]> {
    if (!isValidCoord(lat, lng)) return [];
    const ref = { lat, lng };
    const radius = Math.min(
      Math.max(radiusM ?? DEFAULT_NEAR_RADIUS_M, NEAR_MIN_RADIUS_M),
      NEAR_MAX_RADIUS_M,
    );
    const hits = await this.google.searchNearbyByDistance(lat, lng, radius);
    // Only places Google actually has a photo for: a card without a picture is
    // never shown on the home screen.
    const withPhoto = hits.filter((h) => !!h.photoName);
    this.logger.log(
      `Nearest (${lat.toFixed(3)},${lng.toFixed(3)}, ${radius} m): ${hits.length} Google places, ${withPhoto.length} with a photo`,
    );
    let items = withPhoto.map((h) => this.liveItem(h, ref)).sort(byDistance);
    if (items.length < MIN_LIVE_RESULTS) {
      const wiki = await this.wikiNearby(ref, WIKI_MAX_RADIUS_M, NEARBY_MAX_ITEMS);
      items = this.mergeUnique(items, wiki).sort(byDistance);
    }
    return items.slice(0, NEARBY_MAX_ITEMS);
  }

  /**
   * "Big places": the nearest bus stands, railway stations and colleges around
   * the rider (live Google data, photo required, at most BIG_PER_KIND of each
   * kind), nearest first. Topped up from Wikipedia when Google has too few.
   * No fixed list: nothing found means [].
   */
  async getBigPlaces(lat: number, lng: number): Promise<PlaceItemDto[]> {
    if (!isValidCoord(lat, lng)) return [];
    const ref = { lat, lng };
    const hits = (await this.google.searchBigPlaces(lat, lng, BIG_RADIUS_M)).filter((h) => !!h.photoName);
    const kindOf = (h: NearbyPlaceHit): string => {
      const t = h.types ?? [];
      if (t.includes('bus_station')) return 'bus';
      if (t.includes('train_station')) return 'train';
      if (t.includes('university')) return 'campus';
      return 'other';
    };
    const perKind = new Map<string, number>();
    const live = hits
      .map((h) => ({ kind: kindOf(h), item: this.liveItem(h, ref) }))
      .sort((a, b) => byDistance(a.item, b.item))
      .filter(({ kind }) => {
        const n = perKind.get(kind) ?? 0;
        if (n >= BIG_PER_KIND) return false;
        perKind.set(kind, n + 1);
        return true;
      })
      .map(({ item }) => item);
    this.logger.log(
      `Big places (${lat.toFixed(3)},${lng.toFixed(3)}): ${hits.length} Google places with a photo, ${live.length} kept`,
    );
    let items = live;
    if (items.length < BIG_MIN_RESULTS) {
      const wiki = await this.wikiNearby(ref, WIKI_MAX_RADIUS_M, 20, (h) =>
        BIG_WORDS.test(`${h.title} ${h.description}`),
      );
      items = this.mergeUnique(items, wiki).sort(byDistance);
    }
    return items.slice(0, BIG_MAX_ITEMS);
  }

  /**
   * "Popular places" nearby: well-rated, destination-worthy places (sights,
   * temples, parks, malls…) within 25 km, photo required, nearest first.
   * Live Google data topped up from Wikipedia sights; no fixed list.
   */
  async getPopular(lat: number, lng: number): Promise<PlaceItemDto[]> {
    if (!isValidCoord(lat, lng)) return [];
    const ref = { lat, lng };
    const hits = await this.google.searchNearbyByPopularity(lat, lng, POPULAR_RADIUS_M);
    let items = hits
      .filter(
        (h) =>
          !!h.photoName &&
          h.rating !== null &&
          h.rating >= POPULAR_MIN_RATING &&
          (h.ratingCount ?? 0) >= POPULAR_MIN_RATING_COUNT,
      )
      .map((h) => this.liveItem(h, ref))
      .sort(byDistance);
    this.logger.log(`Popular (${lat.toFixed(3)},${lng.toFixed(3)}): ${hits.length} Google places, ${items.length} kept`);
    if (items.length < POPULAR_MIN_RESULTS) {
      const wiki = await this.wikiNearby(ref, WIKI_MAX_RADIUS_M, POPULAR_MAX_ITEMS, (h) => h.attraction);
      items = this.mergeUnique(items, wiki).sort(byDistance);
    }
    return items.slice(0, POPULAR_MAX_ITEMS);
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

  /** Saved-place lookup for a set of geo keys → map by geoKey. */
  private async savedByGeoKey(userId: string, geoKeys: string[]): Promise<Map<string, SavedPlaceEntity>> {
    if (geoKeys.length === 0) return new Map();
    const saved = await this.savedPlaces
      .createQueryBuilder('sp')
      .where('sp.userId = :userId AND sp.geoKey IN (:...keys)', { userId, keys: geoKeys })
      .getMany();
    return new Map(saved.map((s) => [s.geoKey, s]));
  }

  async getRecent(userId: string, limit = 5): Promise<PlaceItemDto[]> {
    // SEC-5: NaN slips through Math.max/Math.min (every NaN comparison is
    // false) into `LIMIT $2` — sanitize at the boundary, then clamp 1..10.
    const safeLimit = Number.isFinite(limit) ? limit : 5;
    const clampedLimit = Math.min(Math.max(1, safeLimit), 10);
    // Distinct dropoff by geoKey (lat/lng rounded to 4 decimals), newest first.
    // Exclude system-cancelled rides.
    const rows = await this.rides.query(
      `SELECT * FROM (SELECT DISTINCT ON (geo_key) geo_key, title, addr, lat, lng, created_at
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
       ORDER BY geo_key, created_at DESC) latest ORDER BY created_at DESC
       LIMIT $2`,
      [userId, clampedLimit * 3],
    ) as Array<{ geo_key: string; title: string; addr: string; lat: number; lng: number; created_at: Date }>;

    // Sort by most recent and take top N.
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const topRows = rows.slice(0, clampedLimit);

    const savedMap = await this.savedByGeoKey(userId, topRows.map((r) => r.geo_key));

    return topRows.map((r) => {
      const sp = savedMap.get(r.geo_key);
      return {
        id: `recent-${r.geo_key}`,
        title: r.title || r.addr,
        subtitle: r.addr,
        lat: Number(r.lat),
        lng: Number(r.lng),
        imageUrl: null,
        saved: !!sp,
        savedId: sp?.id ?? null,
      };
    });
  }

  /**
   * "Frequently visited": the drop-offs this rider has gone to MOST OFTEN
   * (at least FREQUENT_MIN_VISITS trips), most-visited first, ties broken by
   * the most recent trip. Built purely from the rider's own ride history —
   * a new rider simply gets []. Only COMPLETED rides count as visits: cancelled
   * rides and ones still in flight (requested / matched / in progress) do not.
   */
  async getFrequent(userId: string, limit = 5): Promise<PlaceItemDto[]> {
    const safeLimit = Number.isFinite(limit) ? limit : 5;
    const clampedLimit = Math.min(Math.max(1, safeLimit), FREQUENT_MAX_ITEMS);
    const rows = (await this.rides.query(
      `SELECT geo_key,
              COUNT(*)::int AS visits,
              MAX(created_at) AS last_at,
              (ARRAY_AGG(addr ORDER BY created_at DESC))[1] AS addr,
              (ARRAY_AGG(lat ORDER BY created_at DESC))[1] AS lat,
              (ARRAY_AGG(lng ORDER BY created_at DESC))[1] AS lng
       FROM (
         SELECT
           round(CAST((r.dropoff->>'lat') AS numeric), 4)::text || ',' || round(CAST((r.dropoff->>'lng') AS numeric), 4)::text AS geo_key,
           r.dropoff->>'address' AS addr,
           CAST(r.dropoff->>'lat' AS double precision) AS lat,
           CAST(r.dropoff->>'lng' AS double precision) AS lng,
           r."createdAt" AS created_at
         FROM rides r
         WHERE r."riderId" = $1
           AND r.status = 'completed'
           AND r.dropoff IS NOT NULL
       ) sub
       GROUP BY geo_key
       HAVING COUNT(*) >= $2
       ORDER BY visits DESC, last_at DESC
       LIMIT $3`,
      [userId, FREQUENT_MIN_VISITS, clampedLimit],
    )) as Array<{ geo_key: string; visits: number; addr: string; lat: number; lng: number }>;

    const savedMap = await this.savedByGeoKey(userId, rows.map((r) => r.geo_key));

    return rows.map((r) => {
      const sp = savedMap.get(r.geo_key);
      const address = r.addr ?? '';
      return {
        id: `frequent-${r.geo_key}`,
        title: address.split(',')[0]?.trim() || address,
        subtitle: address,
        lat: Number(r.lat),
        lng: Number(r.lng),
        imageUrl: null,
        saved: !!sp,
        savedId: sp?.id ?? null,
        visitCount: Number(r.visits),
      };
    });
  }
}
