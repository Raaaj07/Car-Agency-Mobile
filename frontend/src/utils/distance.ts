/**
 * Distance helpers for the location-based suggestions on the rider home screen.
 */

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two lat/lng points, in kilometres. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Short, human distance label for a place card:
 *   0.05 → "<100 m", 0.3 → "300 m", 2.34 → "2.3 km", 14.6 → "15 km".
 * Returns null when the distance is unknown (card simply omits the label).
 */
export function formatDistance(km?: number | null): string | null {
  if (km == null || !Number.isFinite(km) || km < 0) return null;
  if (km < 0.1) return '<100 m';
  if (km < 1) return `${Math.round((km * 1000) / 50) * 50} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
