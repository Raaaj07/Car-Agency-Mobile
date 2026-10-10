const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

if (!MAPBOX_TOKEN && __DEV__) {
  console.warn('[mapbox] EXPO_PUBLIC_MAPBOX_TOKEN is missing — address search and routes will fail.');
}

export interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
}

function requireToken(): string {
  if (!MAPBOX_TOKEN) throw new Error('Map service is not configured. Missing EXPO_PUBLIC_MAPBOX_TOKEN.');
  return MAPBOX_TOKEN;
}

export async function searchAddress(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];
  const token = requireToken();
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=IN&limit=5`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Map search failed (${res.status})`);
    const data = await res.json();
    return (data.features ?? []).map((f: any) => ({
      address: f.place_name,
      lng: f.center[0],
      lat: f.center[1],
    }));
  } finally {
    clearTimeout(timer);
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!MAPBOX_TOKEN) {
    if (__DEV__) console.warn('[mapbox] EXPO_PUBLIC_MAPBOX_TOKEN missing, reverseGeocode returning null');
    return null;
  }
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // SEC-10: status only — the URL itself carries the access token.
      if (__DEV__) console.warn(`[mapbox] Reverse geocode HTTP error ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.features?.[0]?.place_name ?? null;
  } catch (err) {
    // SEC-10: message only, dev-only — an error object can embed the
    // request URL (which carries the token) or verbose transport details.
    if (__DEV__) {
      console.warn('[mapbox] Reverse geocode error:', err instanceof Error ? err.message : 'unknown');
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Mapbox Static Image thumbnail URL (client-side fallback for place photos) */
export function placeThumbUrl(lat: number, lng: number, w: number, h: number): string | null {
  if (!MAPBOX_TOKEN) return null;
  const W = Math.round(w * 2);
  const H = Math.round(h * 2);
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/pin-s+211B4E(${lng},${lat})/${lng},${lat},13/${W}x${H}@2x?access_token=${MAPBOX_TOKEN}`;
}


export interface RouteResult {
  // [lng, lat] pairs, already in the order Mapbox's own map layers expect.
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
}

// Road-following route between two points, via the Mapbox Directions API —
// used to draw the actual road path (not a straight line) and to show
// real distance/ETA on VehicleSelectionScreen.
export async function getRoute(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
): Promise<RouteResult | null> {
  const token = requireToken();
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?geometries=geojson&overview=full&access_token=${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;
    return {
      coordinates: route.geometry.coordinates,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}