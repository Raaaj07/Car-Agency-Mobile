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

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Unknown location';
  const token = requireToken();
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Reverse geocode failed (${res.status})`);
    const data = await res.json();
    return data.features?.[0]?.place_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } finally {
    clearTimeout(timer);
  }
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