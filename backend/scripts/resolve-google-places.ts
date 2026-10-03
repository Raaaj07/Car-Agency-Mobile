/**
 * One-off script to resolve Salem places via Google Places API (New) Text Search.
 * Run: npx ts-node scripts/resolve-google-places.ts
 * Requires: GOOGLE_PLACES_API_KEY environment variable.
 */
import { PLACES_CONFIG } from '../src/places/places.config';

interface TextSearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    photos?: Array<{ name: string }>;
  }>;
}

async function resolvePlace(query: string, apiKey: string) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.photos',
      },
      body: JSON.stringify({
        textQuery: query,
        regionCode: 'IN',
        languageCode: 'en',
        maxResultCount: 1,
        locationBias: {
          circle: {
            center: { latitude: 11.6643, longitude: 78.146 },
            radius: 30000,
          },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`FAILED (${res.status}) for query "${query}": ${await res.text()}`);
      return;
    }

    const data = (await res.json()) as TextSearchResponse;
    const match = data.places?.[0];
    if (match) {
      console.log(`\n----------------------------------------`);
      console.log(`Input Query: "${query}"`);
      console.log(`Google ID:   ${match.id}`);
      console.log(`Matched Name:${match.displayName?.text}`);
      console.log(`Address:     ${match.formattedAddress}`);
      console.log(`Coords:      lat: ${match.location?.latitude}, lng: ${match.location?.longitude}`);
      console.log(`Photos:      ${match.photos?.length ?? 0}`);
    } else {
      console.log(`\nNo match found for query "${query}"`);
    }
  } catch (err) {
    console.error(`Error resolving "${query}":`, err);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('ERROR: GOOGLE_PLACES_API_KEY environment variable is required.');
    process.exit(1);
  }

  const allConfigItems = [
    ...PLACES_CONFIG.quickPicks,
    ...PLACES_CONFIG.popular,
    ...PLACES_CONFIG.cityHighlights,
  ];

  console.log(`Resolving ${allConfigItems.length} curated places from places.config.ts...`);
  for (const item of allConfigItems) {
    await resolvePlace(`${item.title}, Salem, Tamil Nadu, India`, apiKey);
  }
}

void main();
