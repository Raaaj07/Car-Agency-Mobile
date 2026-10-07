/**
 * places.ts — typed wrappers over the Vazhi backend /places routes.
 *
 * Also re-exports placeThumbUrl / placePhotoUrl (legacy image helpers used
 * by the old home screen; kept so existing call sites compile unchanged).
 */
import { api, API_URL } from './client';

// ── Shared types ────────────────────────────────────────────────────────────

export interface PlaceItem {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  imageUrl: string | null;
  saved?: boolean;
  savedId?: string | null;
  /** Straight-line km from the rider's current location (location-aware lists only). */
  distanceKm?: number | null;
}

export interface SavedPlace {
  id: string;
  label?: string | null;
  title: string;
  address: string;
  lat: number;
  lng: number;
}

export interface PopularPlacesResponse {
  quickPicks: PlaceItem[];
  popular: PlaceItem[];
  cityHighlights: PlaceItem[];
}

// ── API wrappers ─────────────────────────────────────────────────────────────

export const placesApi = {
  /** GET /places/saved */
  getSaved: async (): Promise<SavedPlace[]> =>
    (await api.get<SavedPlace[]>('/places/saved')).data,

  /** POST /places/saved – upsert by (userId, geoKey) */
  upsertSaved: async (body: {
    title: string;
    address: string;
    lat: number;
    lng: number;
    label?: 'home' | 'work';
  }): Promise<SavedPlace> => (await api.post<SavedPlace>('/places/saved', body)).data,

  /** DELETE /places/saved/:id */
  deleteSaved: async (id: string): Promise<void> => {
    await api.delete(`/places/saved/${id}`);
  },

  /** GET /places/recent?limit=5 */
  getRecent: async (limit = 5): Promise<PlaceItem[]> =>
    (await api.get<PlaceItem[]>('/places/recent', { params: { limit } })).data.map(absolutizeImageUrl),

  /** GET /places/popular?lat=&lng= */
  getPopular: async (coords?: { lat: number; lng: number }): Promise<PopularPlacesResponse> => {
    const res = (
      await api.get<PopularPlacesResponse>('/places/popular', {
        params: coords ? { lat: coords.lat, lng: coords.lng } : {},
      })
    ).data;
    return {
      quickPicks: res.quickPicks.map(absolutizeImageUrl),
      popular: res.popular.map(absolutizeImageUrl),
      cityHighlights: res.cityHighlights.map(absolutizeImageUrl),
    };
  },

  /** GET /places/nearby?lat=&lng=[&radius=] — live location-based suggestions */
  getNearby: async (coords: { lat: number; lng: number }): Promise<PlaceItem[]> =>
    (
      await api.get<PlaceItem[]>('/places/nearby', {
        params: { lat: coords.lat, lng: coords.lng },
      })
    ).data.map(absolutizeImageUrl),
};

/**
 * The backend serves place photos as paths relative to the API base
 * (/places/photo/<id>), or absolute URLs when PUBLIC_API_URL is set.
 * Prefix relative paths with this app's API base so <Image> can fetch them.
 */
export function absolutizeImageUrl(item: PlaceItem): PlaceItem {
  if (item.imageUrl && item.imageUrl.startsWith('/')) {
    return { ...item, imageUrl: `${API_URL}${item.imageUrl}` };
  }
  return item;
}

// ── Legacy image helpers (kept for backward compat) ──────────────────────────

const PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACE;
const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

/** Map image of a spot on the planet, sized w×h (dp). Null when no key/token is configured. */
export function placeThumbUrl(lat: number, lng: number, w: number, h: number): string | null {
  if (GOOGLE_MAPS_KEY) {
    const W = Math.max(1, Math.min(Math.round(w), 640));
    const H = Math.max(1, Math.min(Math.round(h), 640));
    return (
      `https://maps.googleapis.com/maps/api/staticmap` +
      `?center=${lat},${lng}&zoom=16&size=${W}x${H}&scale=2` +
      `&maptype=roadmap&markers=color:0x211B4E|size:mid|${lat},${lng}` +
      `&key=${GOOGLE_MAPS_KEY}`
    );
  }
  if (!MAPBOX_TOKEN) return null;
  const W = Math.round(w * 2);
  const H = Math.round(h * 2);
  return (
    `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/` +
    `pin-s+211B4E(${lng},${lat})/${lng},${lat},13/${W}x${H}@2x?access_token=${MAPBOX_TOKEN}`
  );
}

const photoCache = new Map<string, string | null>();

/** Photo URL for a place address, or null when unconfigured/unknown. */
export async function placePhotoUrl(address: string): Promise<string | null> {
  const query = address.trim();
  if (!PLACES_KEY || !query) return null;
  if (photoCache.has(query)) return photoCache.get(query) ?? null;

  let result: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': PLACES_KEY,
          'X-Goog-FieldMask': 'places.photos.name',
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'en',
          regionCode: 'IN',
          maxResultCount: 1,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const photoName = data?.places?.[0]?.photos?.[0]?.name;
        if (typeof photoName === 'string' && photoName) {
          result = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&key=${PLACES_KEY}`;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Network hiccup / abort → static-map fallback.
  }

  if (result) photoCache.set(query, result);
  return result;
}
