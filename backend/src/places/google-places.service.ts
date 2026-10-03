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
const FETCH_TIMEOUT_MS = 8000;
// Metadata: 24 h positive / 10 min negative. Photo bytes: 1 h.
const META_TTL_POSITIVE_MS = 24 * 60 * 60 * 1000;
const META_TTL_NEGATIVE_MS = 10 * 60 * 1000;
const PHOTO_TTL_MS = 60 * 60 * 1000;

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

function firstPhotoOf(payload: unknown): { name: string; attribution: string | null } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const places = (payload as { places?: unknown }).places;
  if (!Array.isArray(places) || places.length === 0) return null;
  const first = places[0] as { photos?: unknown };
  if (!Array.isArray(first.photos) || first.photos.length === 0) return null;
  const photo = first.photos[0] as {
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

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);
  private readonly metaCache = new Map<string, MetaCacheEntry>();
  private readonly photoCache = new Map<string, PhotoCacheEntry>();
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
    const key = this.apiKey;
    if (!key) return null;

    const resolved = await this.resolvePhoto(item);
    if (!resolved) return null;

    const cached = this.photoCache.get(resolved.photoName);
    if (cached && Date.now() - cached.at < PHOTO_TTL_MS) {
      return { body: cached.body, contentType: cached.contentType };
    }

    try {
      const url =
        `https://places.googleapis.com/v1/${resolved.photoName}/media` +
        `?maxWidthPx=800&key=${encodeURIComponent(key)}`;
      const res = await fetchWithTimeout(url, { method: 'GET' }, FETCH_TIMEOUT_MS);
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentType.startsWith('image/')) {
        this.logger.warn(`Places photo media failed for ${item.id}: HTTP ${res.status} (${contentType})`);
        return null;
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0) return null;
      this.photoCache.set(resolved.photoName, { at: Date.now(), body, contentType });
      return { body, contentType };
    } catch (err) {
      this.logger.warn(`Places photo media error for ${item.id}: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }
}
