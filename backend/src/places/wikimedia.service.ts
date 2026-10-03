import { Injectable, Logger } from '@nestjs/common';
import { haversineKm } from '../common/geo-utils';

/**
 * Keyless place-photo fallback via Wikimedia Commons (no API key, generous
 * rate limits, hotlinkable thumbnails). Used when Google Places has no key
 * or no photo for a spot — real, location-true photos instead of pins.
 *
 * Strategy: title search in File namespace first (most relevant), then
 * geographic search around the coordinates (nearest files first).
 * Never throws — returns null when nothing suitable is found.
 */
export interface WikiPhoto {
  url: string;
  pageUrl: string | null;
}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const FETCH_TIMEOUT_MS = 8000;
const THUMB_SIZE = 800;
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
// Wikimedia's User-Agent policy requires an identifying agent.
const USER_AGENT = 'VazhiApp/1.0 (place-photo-fallback; contact: support@vazhi.app)';
const IMAGE_EXT_PATTERN = /\.(jpe?g|png|webp)([/.?]|$)/i;
// Title-search hits must be geotagged near the place — Commons full-text
// search otherwise returns plausible-looking but unrelated files.
const TITLE_MATCH_MAX_KM = 10;

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

interface ThumbCandidate {
  url: string;
  pageUrl: string | null;
  pageTitle: string | null;
  lat: number | null;
  lon: number | null;
}

// Generic geo/admin/honorific tokens that carry no identifying signal.
const STOPWORDS = new Set([
  'salem', 'tamil', 'nadu', 'india', 'new', 'govt', 'government',
  'shri', 'sri', 'sree', 'arulmigu', 'thiru', 'of', 'the', 'and', 'a',
  'road', 'street', 'nagar', 'district', 'central',
]);

function tokensOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/** Shared-token overlap between the place name and a candidate file. */
function relevanceScore(queryTokens: Set<string>, candidate: ThumbCandidate): number {
  if (queryTokens.size === 0) return 1;
  const haystack = tokensOf(`${candidate.pageTitle ?? ''} ${candidate.url}`);
  let score = 0;
  for (const t of queryTokens) if (haystack.has(t)) score++;
  return score;
}

function thumbCandidates(payload: unknown): ThumbCandidate[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const pages = (payload as { query?: { pages?: Record<string, unknown> } }).query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  // Generator results carry an `index` in geosearch order (nearest first).
  const ordered = Object.values(pages).sort((a, b) => {
    const ai = (a as { index?: unknown }).index;
    const bi = (b as { index?: unknown }).index;
    return (typeof ai === 'number' ? ai : 0) - (typeof bi === 'number' ? bi : 0);
  });
  const out: ThumbCandidate[] = [];
  for (const page of ordered) {
    const p = page as {
      thumbnail?: { source?: unknown };
      fullurl?: unknown;
      title?: unknown;
      coordinates?: unknown;
    };
    const src = p.thumbnail?.source;
    if (typeof src !== 'string' || !src) continue;
    if (!IMAGE_EXT_PATTERN.test(src)) continue;
    let lat: number | null = null;
    let lon: number | null = null;
    if (Array.isArray(p.coordinates) && p.coordinates.length > 0) {
      const c = p.coordinates[0] as { lat?: unknown; lon?: unknown };
      if (typeof c.lat === 'number' && typeof c.lon === 'number') {
        lat = c.lat;
        lon = c.lon;
      }
    }
    out.push({
      url: src.startsWith('http') ? src : `https:${src}`,
      pageUrl: typeof p.fullurl === 'string' ? p.fullurl : null,
      pageTitle: typeof p.title === 'string' ? p.title : null,
      lat,
      lon,
    });
  }
  return out;
}

@Injectable()
export class WikimediaService {
  private readonly logger = new Logger(WikimediaService.name);
  private readonly cache = new Map<string, { at: number; value: WikiPhoto | null }>();

  /**
   * Best-effort photo for a named spot. title/subtitle identify the place,
   * lat/lng scope the geographic fallback.
   */
  async findPhoto(
    cacheKey: string,
    title: string,
    subtitle: string,
    lat: number,
    lng: number,
  ): Promise<WikiPhoto | null> {
    const key = `wiki:${cacheKey}`;
    const cached = this.cache.get(key);
    if (cached) {
      const ttl = cached.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      if (Date.now() - cached.at < ttl) return cached.value;
      this.cache.delete(key);
    }

    let result: WikiPhoto | null = null;
    try {
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const queryTokens = tokensOf(`${title} ${subtitle.split(',')[0] ?? ''}`);
      result =
        (hasCoords ? await this.searchByTitle(title, subtitle, lat, lng, queryTokens) : null) ??
        (await this.searchByGeo(lat, lng, queryTokens));
    } catch (err) {
      this.logger.warn(`Wikimedia lookup failed for ${cacheKey}: ${(err as Error)?.message ?? err}`);
      result = null;
    }
    this.cache.set(key, { at: Date.now(), value: result });
    return result;
  }

  private async searchByTitle(
    title: string,
    subtitle: string,
    lat: number,
    lng: number,
    queryTokens: Set<string>,
  ): Promise<WikiPhoto | null> {
    const query = `${title} ${subtitle.split(',')[0] ?? ''}`.trim();
    if (!query) return null;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'pageimages|coordinates|info',
      inprop: 'url',
      piprop: 'thumbnail',
      pithumbsize: String(THUMB_SIZE),
      generator: 'search',
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: '6',
      gsrlimit: '8',
    });
    const payload = await fetchJson(`${COMMONS_API}?${params.toString()}`);
    const ref = { lat, lng };
    for (const c of thumbCandidates(payload)) {
      // Ungeotagged scans/paintings can still match when the name overlap
      // is strong (>=2 real tokens); geotagged files must additionally
      // sit near the place. Either way this kills text-match false
      // positives (wrong city/country, unrelated subjects).
      const overlap = relevanceScore(queryTokens, c);
      if (c.lat === null || c.lon === null) {
        if (overlap < 2) continue;
      } else {
        if (haversineKm(ref, { lat: c.lat, lng: c.lon }) > TITLE_MATCH_MAX_KM) continue;
        if (overlap < 1) continue;
      }
      return { url: c.url, pageUrl: c.pageUrl };
    }
    return null;
  }

  private async searchByGeo(
    lat: number,
    lng: number,
    queryTokens: Set<string>,
  ): Promise<WikiPhoto | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'pageimages|info',
      inprop: 'url',
      piprop: 'thumbnail',
      pithumbsize: String(THUMB_SIZE),
      generator: 'geosearch',
      ggscoord: `${lat}|${lng}`,
      ggsradius: '5000',
      ggsnamespace: '6',
      ggslimit: '20',
    });
    // Nearest-first, but only files that share a real token with the place
    // name — a random nearby file is more misleading than no photo.
    // Geosearch intermittently returns empty pages, so retry once.
    let candidates = thumbCandidates(await fetchJson(`${COMMONS_API}?${params.toString()}`));
    if (candidates.length === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      candidates = thumbCandidates(await fetchJson(`${COMMONS_API}?${params.toString()}`));
    }
    for (const c of candidates) {
      if (relevanceScore(queryTokens, c) < 1) continue;
      return { url: c.url, pageUrl: c.pageUrl };
    }
    return null;
  }
}
