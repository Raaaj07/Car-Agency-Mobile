import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedPlaceEntity } from './entities/saved-place.entity';
import { UpsertSavedPlaceDto } from './dto/upsert-saved-place.dto';
import { PlaceItemDto, SavedPlaceDto } from './dto/place-item.dto';
import { RideEntity } from '../rides/entities/ride.entity';
import { haversineKm } from '../common/geo-utils';
import { PLACES_CONFIG, PlaceConfigItem } from './places.config';
import { GooglePlacesService } from './google-places.service';
import { WikimediaService } from './wikimedia.service';

function makeGeoKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// Every curated spot (for recent-dropoff photo matching).
const CURATED_PLACES: PlaceConfigItem[] = [
  ...PLACES_CONFIG.quickPicks,
  ...PLACES_CONFIG.popular,
  ...PLACES_CONFIG.cityHighlights,
];

// When Google returns nothing (no API key / outage) "Near You" falls back to
// the curated places within this radius so the rider still gets suggestions.
const NEARBY_FALLBACK_MAX_KM = 25;
const NEARBY_MAX_ITEMS = 10;

/** Straight-line distance rounded to 0.1 km (what the app displays). */
function distanceKmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.round(haversineKm(a, b) * 10) / 10;
}

@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(SavedPlaceEntity)
    private readonly savedPlaces: Repository<SavedPlaceEntity>,
    @InjectRepository(RideEntity)
    private readonly rides: Repository<RideEntity>,
    private readonly googlePhotos: GooglePlacesService,
    private readonly wikiPhotos: WikimediaService,
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
   * Returns a path RELATIVE to the API base (e.g. /places/photo/pop-kottai).
   * The app prefixes it with its own EXPO_PUBLIC_API_URL (which already
   * contains /api/v1). Do NOT prefix PUBLIC_API_URL here: it usually lacks the
   * global /api/v1 prefix, which made every proxied photo URL a 404.
   */
  private photoUrl(path: string): string {
    return path;
  }

  /**
   * Live nearby suggestions around the rider's CURRENT location: famous /
   * frequently-visited places (tourist spots, colleges, hospitals, transit,
   * malls, food). Returned NEAREST FIRST, each with `distanceKm`. When Google
   * has nothing (missing key / outage) it falls back to the curated places
   * within NEARBY_FALLBACK_MAX_KM, so the home screen is not left empty.
   */
  async getNearby(lat: number, lng: number, radiusM?: number): Promise<PlaceItemDto[]> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const ref = { lat, lng };
    const hits = await this.googlePhotos.searchNearby(lat, lng, radiusM);
    if (hits.length === 0) return this.curatedNear(ref);
    const items = await Promise.all(
      hits.map(async (h): Promise<PlaceItemDto> => {
        let imageUrl: string | null = null;
        if (h.photoName) {
          imageUrl = this.photoUrl(`/places/photo/g/${h.googlePlaceId}`);
        } else {
          // Keyless fallback so live suggestions still show real photos.
          const wiki = await this.wikiPhotos.findPhoto(
            `nearby:${h.googlePlaceId}`,
            h.title,
            h.subtitle,
            h.lat,
            h.lng,
          );
          imageUrl = wiki?.url ?? null;
        }
        return {
          id: `nearby-${h.googlePlaceId}`,
          title: h.title,
          subtitle: h.subtitle,
          lat: h.lat,
          lng: h.lng,
          imageUrl,
          distanceKm: distanceKmBetween(ref, h),
        };
      }),
    );
    // Google ranks by popularity; the rider asked for the NEAREST places.
    return items.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  }

  /** Curated places within NEARBY_FALLBACK_MAX_KM of `ref`, nearest first. */
  private curatedNear(ref: { lat: number; lng: number }): PlaceItemDto[] {
    const seen = new Set<string>();
    return CURATED_PLACES.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
      .map((item) => ({ item, km: haversineKm(ref, item) }))
      .filter((x) => x.km <= NEARBY_FALLBACK_MAX_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, NEARBY_MAX_ITEMS)
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

  async getPopular(lat?: number, lng?: number): Promise<{
    quickPicks: PlaceItemDto[];
    popular: PlaceItemDto[];
    cityHighlights: PlaceItemDto[];
  }> {
    const ref =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

    const build = async (items: PlaceConfigItem[]): Promise<PlaceItemDto[]> => {
      const mapped: PlaceItemDto[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        lat: item.lat,
        lng: item.lng,
        imageUrl: this.buildImageUrl(item),
        // Distance from the rider's current location (only when it is known).
        ...(ref ? { distanceKm: distanceKmBetween(ref, item) } : {}),
      }));
      // Nearest popular place first.
      if (ref) mapped.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
      return mapped;
    };

    const [quickPicks, popular, cityHighlights] = await Promise.all([
      build(PLACES_CONFIG.quickPicks),
      build(PLACES_CONFIG.popular),
      build(PLACES_CONFIG.cityHighlights),
    ]);
    return { quickPicks, popular, cityHighlights };
  }
}