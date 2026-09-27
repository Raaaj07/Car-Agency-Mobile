const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

export interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
}

export async function searchAddress(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=IN&limit=5`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features ?? []).map((f: any) => ({
    address: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
  }));
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  return data.features?.[0]?.place_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;
  return {
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
}