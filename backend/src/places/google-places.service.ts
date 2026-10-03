import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlaceConfigItem } from './places.config';

export interface ResolvedPlacePhoto {
  googlePlaceId: string;
  photoName: string;
  photoAttribution: string | null;
}

export interface FetchedPlacePhoto {
  body: Buffer;
  contentType: string;
}

export interface NearbyPlaceHit {
  googlePlaceId: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  photoName: string | null;
  photoAttribution: string | null;
}

interface MetaCacheEntry {
  at: number;
  value: ResolvedPlacePhoto | null;
}

interface PhotoCacheEntry {
  at: number;
  body: Buffer;
  contentType: string;
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const FETCH_TIMEOUT_MS = 8000;
// Metadata: 24 h positive / 10 min negative. Photo bytes: 1 h.
// Nearby lists: 1 h positive / 10 min empty.
const META_TTL_POSITIVE_MS = 24 * 60 * 60 * 1000;
const META_TTL_NEGATIVE_MS = 10 * 60 * 1000;
const PHOTO_TTL_MS = 60 * 60 * 1000;
const NEARBY_TTL_MS = 60 * 60 * 1000;
const NEARBY_EMPTY_TTL_MS = 10 * 60 * 1000;

// Place categories worth suggesting: famous spots, colleges, transit,
// food, worship, green spaces — the places people frequently visit.
const NEARBY_INCLUDED_TYPES = [
  'tourist_attraction',
  'museum',
  'park',
  'zoo',
  'amusement_park',
  'stadium',
  'shopping_mall',
  'university',
  'hospital',
  'transit_station',
  'bus_station',
  'railway_station',
  'place_of_worship',
  'restaurant',
  'school',
];

// Google place IDs are URL-safe; reject anything else before it can reach
// the photo proxy or the Google API.
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function photoOfPlace(place: unknown): { name: string; attribution: string | null } | null {
  if (typeof place !== 'object' || place === null) return null;
  const photos = (place as { photos?: unknown }).photos;
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const photo = photos[0] as {
    name?: unknown;
    authorAttributions?: unknown;
  };
  if (typeof photo.name !== 'string' || !photo.name) return null;
  let attribution: string | null = null;
  if (Array.isArray(photo.authorAttributions) && photo.authorAttributions.length > 0) {
    const displayName = (photo.authorAttributions[0] as { displayName?: unknown }).displayName;
    if (typeof displayName === 'string' && displayName) attribution = displayName;
  }
  return { name: photo.name, attribution };
}

function firstPhotoOf(payload: unknown): { name: string; attribution: string | null } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const places = (payload as { places?: unknown }).places;
  if (!Array.isArray(places) || places.length === 0) return null;
  return photoOfPlace(places[0]);
}

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);
  private readonly metaCache = new Map<string, MetaCacheEntry>();
  private readonly photoCache = new Map<string, PhotoCacheEntry>();
  private readonly nearbyCache = new Map<string, { at: number; value: NearbyPlaceHit[] }>();
  private missingKeyWarned = false;

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string | null {
    const key = this.config.get<string>('GOOGLE_PLACES_API_KEY');
    if (!key) {
      if (!this.missingKeyWarned) {
        this.missingKeyWarned = true;
        this.logger.warn('GOOGLE_PLACES_API_KEY is not set — place photos are disabled.');
      }
      return null;
    }
    return key;
  }

  /**
   * Resolve a curated place to a Google photo reference. Uses the curated
   * photoName when present, otherwise Places API (New) text search biased
   * to the curated coordinates. Never throws — returns null on any failure.
   */
  async resolvePhoto(item: PlaceConfigItem): Promise<ResolvedPlacePhoto | null> {
    const cached = this.metaCache.get(item.id);
    if (cached) {
      const ttl = cached.value ? META_TTL_POSITIVE_MS : META_TTL_NEGATIVE_MS;
      if (Date.now() - cached.at < ttl) return cached.value;
      this.metaCache.delete(item.id);
    }

    const key = this.apiKey;
    if (!key) return null;

    // Curated override wins — no Google call needed.
    if (item.photoName) {
      const resolved: ResolvedPlacePhoto = {
        googlePlaceId: item.googlePlaceId ?? '',
        photoName: item.photoName,
        photoAttribution: item.photoAttribution ?? null,
      };
      this.metaCache.set(item.id, { at: Date.now(), value: resolved });
      return resolved;
    }

    try {
      const res = await fetchWithTimeout(
        SEARCH_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'places.id,places.photos.name,places.photos.authorAttributions',
          },
          body: JSON.stringify({
            textQuery: `${item.title}, ${item.subtitle}, India`,
            regionCode: 'IN',
            languageCode: 'en',
            maxResultCount: 1,
            locationBias: {
              circle: {
                center: { latitude: item.lat, longitude: item.lng },
                radius: 5000.0,
              },
            },
          }),
        },
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) {
        this.logger.warn(`Places searchText failed for ${item.id}: HTTP ${res.status}`);
        this.metaCache.set(item.id, { at: Date.now(), value: null });
        return null;
      }
      const payload: unknown = await res.json();
      if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { places?: unknown }).places)) {
        this.metaCache.set(item.id, { at: Date.now(), value: null });
        return null;
      }
      const places = (payload as { places: Array<{ id?: unknown }> }).places;
      const googlePlaceId = places.length > 0 && typeof places[0].id === 'string' ? places[0].id : '';
      const photo = firstPhotoOf(payload);
      if (!photo || !photo.name) {
        this.metaCache.set(item.id, { at: Date.now(), value: null });
        return null;
      }
      const resolved: ResolvedPlacePhoto = {
        googlePlaceId,
        photoName: photo.name,
        photoAttribution: photo.attribution,
      };
      this.metaCache.set(item.id, { at: Date.now(), value: resolved });
      return resolved;
    } catch (err) {
      this.logger.warn(`Places searchText error for ${item.id}: ${(err as Error)?.message ?? err}`);
      this.metaCache.set(item.id, { at: Date.now(), value: null });
      return null;
    }
  }

  /**
   * Download the resolved photo bytes server-side (the API key never leaves
   * the server). Returns null when there is no photo or the fetch fails.
   */
  async fetchPlacePhoto(item: PlaceConfigItem): Promise<FetchedPlacePhoto | null> {
    const resolved = await this.resolvePhoto(item);
    if (!resolved) return null;
    return this.fetchMedia(resolved.photoName, item.id);
  }

  /**
   * Resolve a raw Google place ID (strictly validated) to a photo reference
   * via Place Details. Powers the guard-free /places/photo/g/:id proxy.
   */
  async resolvePhotoByPlaceId(placeId: string): Promise<ResolvedPlacePhoto | null> {
    if (!PLACE_ID_PATTERN.test(placeId)) return null;
    const cacheKey = `g:${placeId}`;
    const cached = this.metaCache.get(cacheKey);
    if (cached) {
      const ttl = cached.value ? META_TTL_POSITIVE_MS : META_TTL_NEGATIVE_MS;
      if (Date.now() - cached.at < ttl) return cached.value;
      this.metaCache.delete(cacheKey);
    }

    const key = this.apiKey;
    if (!key) return null;

    try {
      const url = `https://places.googleapis.com/v1/places/${placeId}`;
      const res = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'id,photos.name,photos.authorAttributions',
          },
        },
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) {
        this.logger.warn(`Places details failed for ${placeId}: HTTP ${res.status}`);
        this.metaCache.set(cacheKey, { at: Date.now(), value: null });
        return null;
      }
      const payload: unknown = await res.json();
      const photo = photoOfPlace(payload);
      if (!photo || !photo.name) {
        this.metaCache.set(cacheKey, { at: Date.now(), value: null });
        return null;
      }
      const resolved: ResolvedPlacePhoto = {
        googlePlaceId: placeId,
        photoName: photo.name,
        photoAttribution: photo.attribution,
      };
      this.metaCache.set(cacheKey, { at: Date.now(), value: resolved });
      return resolved;
    } catch (err) {
      this.logger.warn(`Places details error for ${placeId}: ${(err as Error)?.message ?? err}`);
      this.metaCache.set(cacheKey, { at: Date.now(), value: null });
      return null;
    }
  }

  /** Photo bytes for a validated Google place ID. Null when unavailable. */
  async fetchPlacePhotoById(placeId: string): Promise<FetchedPlacePhoto | null> {
    const resolved = await this.resolvePhotoByPlaceId(placeId);
    if (!resolved) return null;
    return this.fetchMedia(resolved.photoName, placeId);
  }

  /**
   * Famous / frequently-visited places near a coordinate, ranked by Google
   * popularity (tourist spots, colleges, hospitals, transit, malls, food).
   * Never throws — returns [] on any failure (incl. missing API key).
   */
  async searchNearby(lat: number, lng: number, radiusM = 8000): Promise<NearbyPlaceHit[]> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const radius = Math.min(Math.max(Math.round(radiusM), 1000), 20000);
    const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)},${radius}`;
    const cached = this.nearbyCache.get(cacheKey);
    if (cached) {
      const ttl = cached.value.length > 0 ? NEARBY_TTL_MS : NEARBY_EMPTY_TTL_MS;
      if (Date.now() - cached.at < ttl) return cached.value;
      this.nearbyCache.delete(cacheKey);
    }

    const key = this.apiKey;
    if (!key) return [];

    try {
      const res = await fetchWithTimeout(
        NEARBY_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.formattedAddress,places.location,' +
              'places.photos.name,places.photos.authorAttributions,places.types',
          },
          body: JSON.stringify({
            includedTypes: NEARBY_INCLUDED_TYPES,
            maxResultCount: 10,
            rankPreference: 'POPULARITY',
            languageCode: 'en',
            regionCode: 'IN',
            locationRestriction: {
              circle: { center: { latitude: lat, longitude: lng }, radius },
            },
          }),
        },
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) {
        this.logger.warn(`Places searchNearby failed (${lat},${lng}): HTTP ${res.status}`);
        this.nearbyCache.set(cacheKey, { at: Date.now(), value: [] });
        return [];
      }
      const payload = (await res.json()) as { places?: Array<Record<string, unknown>> };
      const hits: NearbyPlaceHit[] = [];
      for (const p of Array.isArray(payload.places) ? payload.places : []) {
        const googlePlaceId = typeof p.id === 'string' ? p.id : '';
        const displayName = p.displayName as { text?: unknown } | undefined;
        const title = typeof displayName?.text === 'string' ? displayName.text : '';
        const location = p.location as { latitude?: unknown; longitude?: unknown } | undefined;
        const plat = typeof location?.latitude === 'number' ? location.latitude : NaN;
        const plng = typeof location?.longitude === 'number' ? location.longitude : NaN;
        if (!googlePlaceId || !title || !Number.isFinite(plat) || !Number.isFinite(plng)) continue;
        const photos = Array.isArray(p.photos) ? (p.photos as Array<Record<string, unknown>>) : [];
        const firstPhoto = photos.length > 0 ? photos[0] : null;
        const photoName = firstPhoto && typeof firstPhoto.name === 'string' ? firstPhoto.name : null;
        let photoAttribution: string | null = null;
        const attributions = firstPhoto?.authorAttributions;
        if (Array.isArray(attributions) && attributions.length > 0) {
          const dn = (attributions[0] as { displayName?: unknown }).displayName;
          if (typeof dn === 'string' && dn) photoAttribution = dn;
        }
        hits.push({
          googlePlaceId,
          title,
          subtitle: typeof p.formattedAddress === 'string' ? p.formattedAddress : '',
          lat: plat,
          lng: plng,
          photoName,
          photoAttribution,
        });
      }
      this.nearbyCache.set(cacheKey, { at: Date.now(), value: hits });
      return hits;
    } catch (err) {
      this.logger.warn(`Places searchNearby error (${lat},${lng}): ${(err as Error)?.message ?? err}`);
      this.nearbyCache.set(cacheKey, { at: Date.now(), value: [] });
      return [];
    }
  }

  private async fetchMedia(photoName: string, logId: string): Promise<FetchedPlacePhoto | null> {
    const key = this.apiKey;
    if (!key) return null;
    const cached = this.photoCache.get(photoName);
    if (cached && Date.now() - cached.at < PHOTO_TTL_MS) {
      return { body: cached.body, contentType: cached.contentType };
    }

    try {
      const url =
        `https://places.googleapis.com/v1/${photoName}/media` +
        `?maxWidthPx=800&key=${encodeURIComponent(key)}`;
      const res = await fetchWithTimeout(url, { method: 'GET' }, FETCH_TIMEOUT_MS);
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentType.startsWith('image/')) {
        this.logger.warn(`Places photo media failed for ${logId}: HTTP ${res.status} (${contentType})`);
        return null;
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0) return null;
      this.photoCache.set(photoName, { at: Date.now(), body, contentType });
      return { body, contentType };
    } catch (err) {
      this.logger.warn(`Places photo media error for ${logId}: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }
}
