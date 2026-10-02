/**
 * Place imagery for the home dashboard.
 *
 * - Place cards use Google Places API (New) Text Search → Place Photos
 *   (`placePhotoUrl`) for a real photo of the searched place. Key:
 *   `EXPO_PUBLIC_GOOGLE_PLACE` (or `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`) —
 *   enable *Places API (New)* for it in Google Cloud Console.
 * - `placeThumbUrl` is the layered fallback / loading placeholder:
 *   Google Static Maps (`EXPO_PUBLIC_GOOGLE_MAPS_KEY`) → Mapbox Static
 *   Images (`EXPO_PUBLIC_MAPBOX_TOKEN`).
 */

const PLACES_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACE;
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

// ── Google Places photos ─────────────────────────────────────────────
// Real photographs of the places the user searched (Places API New:
// Text Search → photo resource → media URL). Results are memoized for the
// app session; failures are NOT cached so a later mount can retry.

const photoCache = new Map<string, string | null>();

/** Photo URL for a place address, or null when unconfigured/unknown (caller falls back to placeThumbUrl). */
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
