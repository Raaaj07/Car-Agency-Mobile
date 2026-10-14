import { Injectable, Logger } from '@nestjs/common';

/**
 * Keyless "places near me" source: Wikipedia's geosearch. Every hit returned
 * here HAS a real photo (the article's lead image), which is exactly what the
 * home-screen place cards need. Used when Google Places is not configured /
 * not responding, or has too few places that carry a photo — so the rider's
 * home screen is never empty just because one provider is down.
 *
 * Wikipedia only searches up to 10 km, and its articles include villages,
 * wards and other non-destinations, so results are filtered to places people
 * actually travel to (temples, forts, lakes, parks, colleges, stations, …).
 *
 * Never throws — returns [] on any failure.
 */
export interface WikiPlaceHit {
  /** Wikipedia page id (digits only) — doubles as the photo-proxy key. */
  pageId: string;
  title: string;
  /** Wikidata short description, e.g. "Hindu temple in Erode, India". */
  description: string;
  lat: number;
  lng: number;
  /** https://upload.wikimedia.org/... thumbnail (already verified as a photo). */
  thumbUrl: string;
  /** Sights / landmarks (temple, fort, lake…) as opposed to everyday places. */
  attraction: boolean;
}

const API = 'https://en.wikipedia.org/w/api.php';
const FETCH_TIMEOUT_MS = 8000;
/** The geosearch API accepts at most 10 000 m. */
export const WIKI_MAX_RADIUS_M = 10_000;
const THUMB_SIZE = 800;
const RESULT_LIMIT = 50; // pageimages returns thumbnails for at most 50 pages
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 10 * 60 * 1000;
const KNOWN_MAX = 2000;
// Wikimedia's User-Agent policy requires an identifying agent.
const USER_AGENT = 'VazhiApp/1.0 (nearby-places; contact: support@vazhi.app)';

const PAGE_ID_PATTERN = /^\d{1,12}$/;
export function isValidWikiPageId(pageId: string): boolean {
  return PAGE_ID_PATTERN.test(pageId);
}

// Real photographs only — no SVG maps/flags/logos.
const PHOTO_EXT = /\.(jpe?g|webp)(\/|\?|$)/i;
const NOT_A_PHOTO = /(map|locator|flag|logo|symbol|seal|emblem|coat[_ -]?of|icon|signature)/i;

// What counts as a place worth travelling to.
const DESTINATION_WORDS = [
  'temple', 'kovil', 'fort', 'dam', 'lake', 'park', 'garden', 'museum', 'college',
  'university', 'institute', 'hospital', 'railway station', 'junction', 'bus stand',
  'bus terminus', 'bus station', 'bus stop', 'airport', 'mall', 'church', 'cathedral',
  'mosque', 'dargah', 'beach', 'falls', 'waterfall', 'sanctuary', 'stadium', 'palace',
  'tower', 'shrine', 'zoo', 'market', 'reservoir', 'hill', 'viewpoint', 'bridge',
  'library', 'theatre', 'cinema', 'resort', 'monument', 'memorial', 'aquarium', 'school',
];
// Sights people visit for their own sake (feeds "Explore your city").
const ATTRACTION_WORDS = [
  'temple', 'kovil', 'fort', 'dam', 'lake', 'park', 'garden', 'museum', 'falls',
  'waterfall', 'sanctuary', 'palace', 'tower', 'shrine', 'zoo', 'beach', 'church',
  'cathedral', 'mosque', 'dargah', 'reservoir', 'hill', 'viewpoint', 'resort',
  'monument', 'memorial', 'aquarium',
];
// Administrative / residential articles that are not destinations.
const EXCLUDED_WORDS = [
  'village in', 'panchayat', 'census town', 'neighbourhood', 'neighborhood', 'locality',
  'suburb', 'administrative', 'taluk', 'constituency', 'ward of', 'ward in', 'mandal',
  'revenue village', 'hamlet', 'municipality in',
];

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pagesOf(payload: unknown): Array<Record<string, unknown>> {
  if (typeof payload !== 'object' || payload === null) return [];
  const pages = (payload as { query?: { pages?: unknown } }).query?.pages;
  if (Array.isArray(pages)) return pages as Array<Record<string, unknown>>;
  if (pages && typeof pages === 'object') return Object.values(pages) as Array<Record<string, unknown>>;
  return [];
}

function thumbOf(page: Record<string, unknown>): string | null {
  const src = (page.thumbnail as { source?: unknown } | undefined)?.source;
  if (typeof src !== 'string' || !src) return null;
  const url = src.startsWith('http') ? src : `https:${src}`;
  return PHOTO_EXT.test(url) && !NOT_A_PHOTO.test(url) ? url : null;
}

function parseHits(payload: unknown): WikiPlaceHit[] {
  const out: WikiPlaceHit[] = [];
  for (const page of pagesOf(payload)) {
    const pageId = String(page.pageid ?? '');
    const title = typeof page.title === 'string' ? page.title : '';
    const description = typeof page.description === 'string' ? page.description : '';
    const thumbUrl = thumbOf(page);
    const coords = Array.isArray(page.coordinates) ? (page.coordinates[0] as { lat?: unknown; lon?: unknown }) : undefined;
    const lat = typeof coords?.lat === 'number' ? coords.lat : NaN;
    const lng = typeof coords?.lon === 'number' ? coords.lon : NaN;
    if (!isValidWikiPageId(pageId) || !title || !thumbUrl || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    const text = `${title} ${description}`.toLowerCase();
    if (includesAny(text, EXCLUDED_WORDS)) continue;
    if (!includesAny(text, DESTINATION_WORDS)) continue;
    out.push({
      pageId,
      title,
      description,
      lat,
      lng,
      thumbUrl,
      attraction: includesAny(text, ATTRACTION_WORDS),
    });
  }
  return out;
}

@Injectable()
export class WikipediaPlacesService {
  private readonly logger = new Logger(WikipediaPlacesService.name);
  private readonly cache = new Map<string, { at: number; value: WikiPlaceHit[] }>();
  private readonly known = new Map<string, WikiPlaceHit>();

  /** Places with a photo within `radiusM` (capped at 10 km) of a coordinate. */
  async searchNearby(lat: number, lng: number, radiusM = WIKI_MAX_RADIUS_M): Promise<WikiPlaceHit[]> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const radius = Math.min(Math.max(Math.round(radiusM), 500), WIKI_MAX_RADIUS_M);
    // ~1 km grid: riders standing in the same area share one upstream call.
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${radius}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      const ttl = cached.value.length > 0 ? POSITIVE_TTL_MS : EMPTY_TTL_MS;
      if (Date.now() - cached.at < ttl) return cached.value;
      this.cache.delete(cacheKey);
    }

    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'geosearch',
      ggscoord: `${lat}|${lng}`,
      ggsradius: String(radius),
      ggslimit: String(RESULT_LIMIT),
      ggsnamespace: '0',
      prop: 'pageimages|coordinates|description',
      piprop: 'thumbnail',
      pithumbsize: String(THUMB_SIZE),
      pilimit: String(RESULT_LIMIT),
      colimit: String(RESULT_LIMIT),
      coprimary: 'primary',
    });
    const payload = await fetchJson(`${API}?${params.toString()}`);
    if (payload === null) {
      // Network / upstream problem: do not cache, so the next request retries.
      this.logger.warn(`Wikipedia geosearch failed (${lat.toFixed(3)},${lng.toFixed(3)})`);
      return [];
    }
    const hits = parseHits(payload);
    this.logger.log(
      `Wikipedia places (${lat.toFixed(3)},${lng.toFixed(3)}, ${radius} m): ${hits.length} with photos`,
    );
    for (const hit of hits) this.remember(hit);
    this.cache.set(cacheKey, { at: Date.now(), value: hits });
    return hits;
  }

  /** A place previously returned by searchNearby, if still remembered. */
  getKnown(pageId: string): WikiPlaceHit | null {
    return this.known.get(pageId) ?? null;
  }

  /**
   * Thumbnail URL for a validated page id — from memory when the place was
   * returned in a search, otherwise asked from Wikipedia (after a restart).
   */
  async thumbUrlFor(pageId: string): Promise<string | null> {
    if (!isValidWikiPageId(pageId)) return null;
    const known = this.known.get(pageId);
    if (known) return known.thumbUrl;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: String(THUMB_SIZE),
      pageids: pageId,
    });
    const payload = await fetchJson(`${API}?${params.toString()}`);
    const page = pagesOf(payload)[0];
    return page ? thumbOf(page) : null;
  }

  private remember(hit: WikiPlaceHit): void {
    this.known.delete(hit.pageId);
    this.known.set(hit.pageId, hit);
    if (this.known.size > KNOWN_MAX) {
      const oldest = this.known.keys().next().value;
      if (oldest !== undefined) this.known.delete(oldest);
    }
  }
}
