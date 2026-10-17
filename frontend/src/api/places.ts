/**
 * places.ts — typed wrappers over the Vazhi backend /places routes.
 *
 * Also re-exports placeThumbUrl (legacy helper kept so existing call sites
 * compile unchanged). SEC-9: place imagery never carries a Google key in the
 * bundle — photos come from the backend proxy (/places/photo/...), and the
 * thumb falls back to the Mapbox static API.
 */
import { api, API_URL } from './client';
import { placeThumbUrl as mapboxThumbUrl } from './mapbox';

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
  /** Google star rating (0-5); live Google places only. */
  rating?: number | null;
  ratingCount?: number | null;
  /** Trips this rider has taken to the place (frequently-visited list only). */
  visitCount?: number;
}

export interface SavedPlace {
  id: string;
  label?: string | null;
  title: string;
  address: string;
  lat: number;
  lng: number;
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

  /** GET /places/frequent?limit=5 — this rider's most-visited drop-offs */
  getFrequent: async (limit = 5): Promise<PlaceItem[]> =>
    (await api.get<PlaceItem[]>('/places/frequent', { params: { limit } })).data,

  /** GET /places/big?lat=&lng= — nearest bus stands, railway stations, colleges */
  getBig: async (coords: { lat: number; lng: number }): Promise<PlaceItem[]> =>
    (
      await api.get<PlaceItem[]>('/places/big', {
        params: { lat: coords.lat, lng: coords.lng },
      })
    ).data.map(absolutizeImageUrl),

  /** GET /places/popular?lat=&lng= — popular places near the rider */
  getPopular: async (coords: { lat: number; lng: number }): Promise<PlaceItem[]> =>
    (
      await api.get<PlaceItem[]>('/places/popular', {
        params: { lat: coords.lat, lng: coords.lng },
      })
    ).data.map(absolutizeImageUrl),

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

// ── Legacy image helper (kept for backward compat) ──────────────────────────

/**
 * Map image of a spot on the planet, sized w×h (dp).
 *
 * SEC-9: this used to prefer Google Static Maps with EXPO_PUBLIC_GOOGLE_MAPS_KEY
 * in the bundle — the key ships in every APK and can be lifted and billed
 * against. Photos/place imagery now come from the backend proxy
 * (/places/photo/... via imageUrl from /places/nearby and friends); the only
 * client key left is the Mapbox token (restricted in the Mapbox account).
 */
export function placeThumbUrl(lat: number, lng: number, w: number, h: number): string | null {
  return mapboxThumbUrl(lat, lng, w, h);
}
