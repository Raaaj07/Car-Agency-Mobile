/// <reference types="jest" />
import {
  MAX_CACHE_BYTES,
  MAX_CACHE_ENTRIES,
  PlaceImageService,
} from './place-image.service';
import { GooglePlacesService } from './google-places.service';
import { WikimediaService } from './wikimedia.service';

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
