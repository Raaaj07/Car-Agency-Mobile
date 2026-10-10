import { Injectable, Logger } from '@nestjs/common';
import type { PlaceConfigItem } from './places.config';
import { GooglePlacesService, isValidGooglePlaceId } from './google-places.service';
import { WikimediaService } from './wikimedia.service';

export interface PlaceImageBytes {
  body: Buffer;
  contentType: string;
}

interface CacheEntry {
  at: number;
  value: PlaceImageBytes | null;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5 min (retry soon if everything failed)

// SEC-7: bound the in-memory image cache (LRU — an entry count AND a byte
// budget). Without caps, every distinct valid-format Google place id a
// client requests becomes a cache entry of up to 5 MB held for 6 h: enough
// distinct ids grow the heap until the process dies, and every miss is a
// billable Google/Wikimedia fetch. Eviction is least-recently-used — hits
// refresh an entry's recency so the working set survives. Exported for the
// spec's fixtures.
export const MAX_CACHE_ENTRIES = 400;
export const MAX_CACHE_BYTES = 32 * 1024 * 1024;

// Wikimedia blocks / rate-limits requests that do not send an identifying
// User-Agent. A phone's <Image> sends a generic one, so the BACKEND downloads
// the image with a proper UA and streams the bytes to the app.
// TODO: replace the contact address with a real one you own.
const USER_AGENT = 'VazhiApp/1.0 (place-photo-proxy; contact: support@vazhi.app)';

// Only these hosts may be downloaded (prevents the proxy being used for SSRF).
// Google photos never arrive here — GooglePlacesService fetches them from
// fixed, Google-hosted endpoints itself — so the download allowlist is exactly
// the Wikimedia set the curated URLs use.
const ALLOWED_HOSTS = new Set([
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
  'commons.wikimedia.org',
]);

// SEC-3: redirects are followed by hand (see download) — every hop re-enters
// isAllowedImageUrl, so at most this many allowlisted hops may be chained.
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** SEC-3: dotted-quad IPv4, or any IPv6/bracketed form (hostnames never carry ':'). */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return '(unparseable)';
  }
}

/**
 * SEC-3: the single gate for every URL this service downloads — the initial
 * URL AND each redirect hop. Only https, only the explicit host allowlist,
 * port 443 only, never an IP literal or localhost — so an allowlisted host
 * that turns malicious cannot bounce the proxy onto cloud metadata or
 * internal services (the classic SSRF-via-redirect).
 */
function isAllowedImageUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.port && parsed.port !== '443') return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (isIpLiteral(host)) return null;
  if (!ALLOWED_HOSTS.has(host)) return null;
  return parsed;
}

/**
 * Turns a curated Wikimedia URL into the list of URLs worth trying.
 * upload.wikimedia.org is the canonical thumbnail host, so it goes first.
 */
function candidateUrls(raw: string): string[] {
  const urls = [raw];
  try {
    const u = new URL(raw);
    if (u.hostname === 'thumb.wikimedia.org') {
      u.hostname = 'upload.wikimedia.org';
      urls.unshift(u.toString());
    }
  } catch {
    return [];
  }
  return urls;
}

@Injectable()
export class PlaceImageService {
  private readonly logger = new Logger(PlaceImageService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private readonly inflight = new Map<string, Promise<PlaceImageBytes | null>>();

  constructor(
    private readonly google: GooglePlacesService,
    private readonly wiki: WikimediaService,
  ) {}

  /**
   * Image bytes for a curated place. Tries, in order:
   *   1. Google Places photo (needs GOOGLE_PLACES_API_KEY + working billing)
   *   2. the curated imageUrl from places.config.ts
   *   3. a Wikimedia Commons search (title, then geo)
   * Every step is verified by actually downloading image bytes, so a step that
   * "resolves" but cannot be downloaded falls through to the next one.
   */
  getCuratedImage(item: PlaceConfigItem): Promise<PlaceImageBytes | null> {
    return this.cached(`curated:${item.id}`, () => this.resolveCurated(item));
  }

  /**
   * Image bytes for a LIVE Google place (Near You / Popular), by Google place
   * ID. Tries, in order:
   *   1. the Google Places photo
   *   2. a Wikimedia Commons search using the place's title + coordinates
   *      (remembered from the search that returned it)
   * Both are downloaded server-side, so the phone only ever receives bytes
   * from this backend — never a Google or Wikimedia link.
   */
  getLiveImage(googlePlaceId: string): Promise<PlaceImageBytes | null> {
    if (!isValidGooglePlaceId(googlePlaceId)) return Promise.resolve(null);
    return this.cached(`live:${googlePlaceId}`, () => this.resolveLive(googlePlaceId));
  }

  /** Shared cache + in-flight de-duplication for every image lookup. */
  private cached(
    key: string,
    job: () => Promise<PlaceImageBytes | null>,
  ): Promise<PlaceImageBytes | null> {
    const cached = this.cache.get(key);
    if (cached) {
      const ttl = cached.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      if (Date.now() - cached.at < ttl) {
        // SEC-7: refresh recency — this is LRU, not FIFO.
        this.cache.delete(key);
        this.cache.set(key, cached);
        return Promise.resolve(cached.value);
      }
      this.forget(key); // expired: drop it (and its bytes) properly
    }
    const running = this.inflight.get(key);
    if (running) return running;

    const started = job()
      .then((value) => {
        this.cache.set(key, { at: Date.now(), value });
        this.cacheBytes += value?.body.length ?? 0;
        this.evictIfNeeded();
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }

  /** Drop one entry, keeping the byte accounting honest. */
  private forget(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cacheBytes -= entry.value?.body.length ?? 0;
    this.cache.delete(key);
  }

  // SEC-7: evict least-recently-used entries until both budgets hold. Map
  // iteration follows insertion order, and deleting the CURRENT entry while
  // iterating a Map is safe.
  private evictIfNeeded(): void {
    for (const key of this.cache.keys()) {
      if (this.cache.size <= MAX_CACHE_ENTRIES && this.cacheBytes <= MAX_CACHE_BYTES) break;
      this.forget(key);
    }
  }

  private async resolveLive(googlePlaceId: string): Promise<PlaceImageBytes | null> {
    // 1. Google
    try {
      const g = await this.google.fetchPlacePhotoById(googlePlaceId);
      if (g) return g;
      this.logger.warn(`[${googlePlaceId}] Google photo unavailable, trying Wikimedia`);
    } catch (err) {
      this.logger.warn(`[${googlePlaceId}] Google photo error: ${(err as Error)?.message ?? err}`);
    }

    // 2. Wikimedia backup (needs the place's name + position)
    const place = this.google.getKnownPlace(googlePlaceId);
    if (!place) {
      this.logger.warn(`[${googlePlaceId}] no remembered place details, cannot try Wikimedia`);
      return null;
    }
    try {
      const w = await this.wiki.findPhoto(
        `live:${googlePlaceId}`,
        place.title,
        place.subtitle,
        place.lat,
        place.lng,
      );
      if (w?.url) {
        for (const url of candidateUrls(w.url)) {
          const img = await this.download(url, googlePlaceId);
          if (img) return img;
        }
      }
    } catch (err) {
      this.logger.warn(`[${googlePlaceId}] Wikimedia search error: ${(err as Error)?.message ?? err}`);
    }

    this.logger.warn(`[${googlePlaceId}] NO image from Google or Wikimedia`);
    return null;
  }

  private async resolveCurated(item: PlaceConfigItem): Promise<PlaceImageBytes | null> {
    // 1. Google
    try {
      const g = await this.google.fetchPlacePhoto(item);
      if (g) return g;
      this.logger.warn(`[${item.id}] Google photo unavailable, trying curated URL`);
    } catch (err) {
      this.logger.warn(`[${item.id}] Google photo error: ${(err as Error)?.message ?? err}`);
    }

    // 2. Curated URL from places.config.ts
    if (item.imageUrl) {
      for (const url of candidateUrls(item.imageUrl)) {
        const img = await this.download(url, item.id);
        if (img) return img;
      }
      this.logger.warn(`[${item.id}] curated imageUrl failed, trying Wikimedia search`);
    }

    // 3. Wikimedia Commons search
    try {
      const w = await this.wiki.findPhoto(item.id, item.title, item.subtitle, item.lat, item.lng);
      if (w?.url) {
        const img = await this.download(w.url, item.id);
        if (img) return img;
      }
    } catch (err) {
      this.logger.warn(`[${item.id}] Wikimedia search error: ${(err as Error)?.message ?? err}`);
    }

    this.logger.warn(`[${item.id}] NO image from Google, curated URL or Wikimedia`);
    return null;
  }

  /**
   * Download one image with a proper User-Agent. Returns null on any problem.
   * Redirects are followed BY HAND (max MAX_REDIRECTS hops, each re-validated
   * through isAllowedImageUrl) — fetch's own `redirect: 'follow'` would accept
   * a hop to an internal address without ever asking us (SEC-3).
   */
  private async download(url: string, logId: string): Promise<PlaceImageBytes | null> {
    if (!isAllowedImageUrl(url)) {
      this.logger.warn(`[${logId}] blocked image host: ${hostOf(url)}`);
      return null;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetchFollowingRedirects(url, logId);
        if (!res) return null; // a hop was blocked / too many redirects — nothing to retry
        const contentType = res.headers.get('content-type') ?? '';
        if (res.status === 429 || res.status >= 500) {
          // transient — wait and retry once
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        if (!res.ok || !contentType.startsWith('image/')) {
          this.logger.warn(`[${logId}] image download failed: HTTP ${res.status} (${contentType}) ${url}`);
          return null;
        }
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length === 0 || body.length > MAX_IMAGE_BYTES) {
          this.logger.warn(`[${logId}] image rejected, size=${body.length} ${url}`);
          return null;
        }
        return { body, contentType };
      } catch (err) {
        this.logger.warn(`[${logId}] image download error: ${(err as Error)?.message ?? err} ${url}`);
      }
    }
    return null;
  }

  /**
   * GET the URL with `redirect: 'manual'` and follow at most MAX_REDIRECTS
   * Location hops — EVERY hop re-validated by isAllowedImageUrl (SEC-3).
   * Resolves with the first non-redirect response; null when a hop is blocked
   * or the chain is too long. Network errors reject (the caller's retry loop
   * handles them exactly like the old single-fetch failures).
   */
  private async fetchFollowingRedirects(url: string, logId: string): Promise<Response | null> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(current, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
          redirect: 'manual',
          signal: controller.signal,
        });
        if (!REDIRECT_STATUSES.has(res.status)) return res;

        const location = res.headers.get('location');
        if (!location) {
          this.logger.warn(`[${logId}] redirect without Location header`);
          return null;
        }
        let next: URL | null;
        try {
          next = new URL(location, current);
        } catch {
          next = null;
        }
        // SEC-3: re-validate EVERY hop — an allowlisted host must not be able
        // to bounce the proxy to an internal/metadata address.
        if (!next || !isAllowedImageUrl(next.toString())) {
          this.logger.warn(`[${logId}] blocked redirect target: ${hostOf(location)}`);
          return null;
        }
        current = next.toString();
      } finally {
        clearTimeout(timer);
      }
    }
    this.logger.warn(`[${logId}] too many redirects (max ${MAX_REDIRECTS})`);
    return null;
  }
}