/// <reference types="jest" />
import {
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  PlaceImageService,
} from './place-image.service';
import { GooglePlacesService } from './google-places.service';
import { WikimediaService } from './wikimedia.service';
import type { PlaceConfigItem } from './places.config';

/**
 * SEC-7: the proxy cache was a plain Map — uncapped, "request many distinct
 * place ids" turned into unbounded heap growth (up to 5 MB per entry, 6 h
 * TTL) plus a billable provider miss per id. Both budgets are now enforced
 * with least-recently-used eviction.
 */
describe('PlaceImageService cache bounding (SEC-7)', () => {
  let google: { fetchPlacePhotoById: jest.Mock };
  let service: PlaceImageService;

  // Matches PLACE_ID_PATTERN (/^[A-Za-z0-9_-]{8,128}$/).
  const id = (n: number) => `ChIJplace${String(n).padStart(6, '0')}`;
  const image = (bytes: number) => ({ body: Buffer.alloc(bytes), contentType: 'image/jpeg' });

  beforeEach(() => {
    google = { fetchPlacePhotoById: jest.fn().mockImplementation(async () => image(1024)) };
    service = new PlaceImageService(
      google as unknown as GooglePlacesService,
      { findPhoto: jest.fn() } as unknown as WikimediaService,
    );
  });

  it('still serves repeat requests from cache within the TTL', async () => {
    await service.getLiveImage(id(7));
    await service.getLiveImage(id(7));

    expect(google.fetchPlacePhotoById).toHaveBeenCalledTimes(1);
  });

  it('evicts the least-recently-used entry past the entry cap (LRU, not FIFO)', async () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      await service.getLiveImage(id(i));
    }
    // A hit right before the overflow refreshes entry #0's recency.
    await service.getLiveImage(id(0));
    const seen = google.fetchPlacePhotoById.mock.calls.length;
    expect(seen).toBe(MAX_CACHE_ENTRIES); // the hit was served from cache

    // One more distinct id pushes the cache over budget.
    await service.getLiveImage(id(MAX_CACHE_ENTRIES));

    // #0 survived (touched recently): still cached, no new provider call.
    await service.getLiveImage(id(0));
    expect(google.fetchPlacePhotoById.mock.calls.length).toBe(seen + 1);

    // #1 was least-recently-used — evicted: the provider is asked again.
    await service.getLiveImage(id(1));
    expect(google.fetchPlacePhotoById.mock.calls.length).toBe(seen + 2);
  });

  it('enforces the byte budget before the entry count', async () => {
    const big = Math.ceil(MAX_CACHE_BYTES / 6); // six of these overflow 32 MB
    google.fetchPlacePhotoById.mockImplementation(async () => image(big));
    const howMany = Math.floor(MAX_CACHE_BYTES / big) + 3; // well past the budget
    expect(howMany).toBeLessThan(MAX_CACHE_ENTRIES); // the byte cap bites first

    for (let i = 0; i < howMany; i++) {
      await service.getLiveImage(id(i));
    }
    const seen = google.fetchPlacePhotoById.mock.calls.length;

    // Oldest entries were evicted by the byte cap...
    await service.getLiveImage(id(0));
    expect(google.fetchPlacePhotoById.mock.calls.length).toBe(seen + 1);

    // ...while the newest is still cached.
    await service.getLiveImage(id(howMany - 1));
    expect(google.fetchPlacePhotoById.mock.calls.length).toBe(seen + 1);
  });
});

/**
 * SEC-3: the proxy downloads bytes server-side, so a redirect the service
 * follows blindly is an SSRF pivot (an allowlisted host bouncing us onto
 * cloud metadata or an internal address). Redirects are now manual, capped
 * at 3 hops, and every hop re-runs the host allowlist.
 */
describe('PlaceImageService SSRF hardening (SEC-3)', () => {
  let google: { fetchPlacePhoto: jest.Mock; fetchPlacePhotoById: jest.Mock };
  let wiki: { findPhoto: jest.Mock };
  let service: PlaceImageService;
  let realFetch: typeof globalThis.fetch;

  const item = (imageUrl: string): PlaceConfigItem => ({
    id: 'ssrf-fixture',
    title: 'Fixture',
    subtitle: 'Test',
    lat: 11.65,
    lng: 78.16,
    imageUrl,
  });

  // A minimal Response stand-in — only what download() reads.
  const response = (status: number, contentType: string | null, bytes = 3) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => Uint8Array.from({ length: bytes }, (_, i) => i + 1).buffer,
  });
  const redirect = (to: string) => ({
    status: 302,
    ok: false,
    headers: { get: (h: string) => (h.toLowerCase() === 'location' ? to : null) },
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  beforeEach(() => {
    google = {
      fetchPlacePhoto: jest.fn().mockResolvedValue(null),
      fetchPlacePhotoById: jest.fn().mockResolvedValue(null),
    };
    wiki = { findPhoto: jest.fn().mockResolvedValue(null) };
    service = new PlaceImageService(
      google as unknown as GooglePlacesService,
      wiki as unknown as WikimediaService,
    );
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('rejects a redirect from an allow-listed host to an internal address', async () => {
    const fetchMock = jest.fn().mockResolvedValue(redirect('http://169.254.169.254/latest/meta-data'));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const out = await service.getCuratedImage(item('https://upload.wikimedia.org/wikipedia/commons/x.jpg'));

    expect(out).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the internal hop was never fetched
  });

  it('follows a redirect to another allow-listed host and returns the bytes', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(redirect('https://commons.wikimedia.org/next.jpg'))
      .mockResolvedValueOnce(response(200, 'image/jpeg'));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const out = await service.getCuratedImage(item('https://commons.wikimedia.org/a.jpg'));

    expect(out?.contentType).toBe('image/jpeg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://commons.wikimedia.org/next.jpg');
  });

  it('gives up after more than 3 redirect hops', async () => {
    const fetchMock = jest.fn().mockImplementation(async (u: string) =>
      redirect(`https://upload.wikimedia.org/next${u}.jpg`),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const out = await service.getCuratedImage(item('https://commons.wikimedia.org/a.jpg'));

    expect(out).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 hops, then stop
  });

  it('never fetches non-https, unknown-host or IP-literal targets at all', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    for (const bad of [
      'http://upload.wikimedia.org/x.jpg', // plaintext
      'https://evil.example.com/x.jpg', // not on the allowlist
      'https://127.0.0.1/x.jpg', // loopback literal
      'https://10.0.0.8:8080/x.jpg', // private range + non-443 port
      'https://[::1]/x.jpg', // IPv6 literal
      'https://localhost/x.jpg',
    ]) {
      expect(await service.getCuratedImage(item(bad))).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
