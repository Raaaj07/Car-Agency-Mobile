import { Injectable, Logger } from '@nestjs/common';
import type { PlaceConfigItem } from './places.config';
import { GooglePlacesService } from './google-places.service';
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

// Wikimedia blocks / rate-limits requests that do not send an identifying
// User-Agent. A phone's <Image> sends a generic one, so the BACKEND downloads
// the image with a proper UA and streams the bytes to the app.
// TODO: replace the contact address with a real one you own.
const USER_AGENT = 'VazhiApp/1.0 (place-photo-proxy; contact: support@vazhi.app)';

// Only these hosts may be downloaded (prevents the proxy being used for SSRF).
const ALLOWED_HOSTS = new Set([
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
  'commons.wikimedia.org',
]);

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
    const key = `curated:${item.id}`;
    const cached = this.cache.get(key);
    if (cached) {
      const ttl = cached.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      if (Date.now() - cached.at < ttl) return Promise.resolve(cached.value);
      this.cache.delete(key);
    }
    const running = this.inflight.get(key);
    if (running) return running;

    const job = this.resolveCurated(item)
      .then((value) => {
        this.cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
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

  /** Download one image with a proper User-Agent. Returns null on any problem. */
  private async download(url: string, logId: string): Promise<PlaceImageBytes | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      this.logger.warn(`[${logId}] blocked image host: ${parsed.hostname}`);
      return null;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
          redirect: 'follow',
          signal: controller.signal,
        });
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
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }
}