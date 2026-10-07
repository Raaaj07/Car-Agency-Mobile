import { PlacesService } from './places.service';
import { PLACES_CONFIG } from './places.config';

// Rider standing in Salem city centre.
const RIDER = { lat: 11.6643, lng: 78.146 };

function makeService(googleHits: unknown[] = []) {
  const google = { searchNearby: jest.fn().mockResolvedValue(googleHits) };
  const wiki = { findPhoto: jest.fn().mockResolvedValue(null) };
  const service = new PlacesService({} as never, {} as never, google as never, wiki as never);
  return { service, google, wiki };
}

const hit = (id: string, lat: number, lng: number) => ({
  googlePlaceId: id,
  title: `Place ${id}`,
  subtitle: 'Salem',
  lat,
  lng,
  photoName: `places/${id}/photos/p1`, // has a photo -> no wikimedia lookup
  photoAttribution: null,
});

describe('PlacesService — location-based suggestions', () => {
  describe('getNearby', () => {
    it('returns the NEAREST places first, each with distanceKm', async () => {
      // Google ranks by popularity, so feed them in a non-distance order.
      const { service } = makeService([
        hit('far-aaaa1111', 11.75, 78.2),
        hit('near-bbbb2222', 11.665, 78.1465),
        hit('mid-cccc3333', 11.7, 78.16),
      ]);

      const items = await service.getNearby(RIDER.lat, RIDER.lng);

      expect(items.map((i) => i.id)).toEqual([
        'nearby-near-bbbb2222',
        'nearby-mid-cccc3333',
        'nearby-far-aaaa1111',
      ]);
      const km = items.map((i) => i.distanceKm as number);
      expect(km.every((d) => typeof d === 'number' && d >= 0)).toBe(true);
      expect(km).toEqual([...km].sort((a, b) => a - b));
      expect(km[0]).toBeLessThan(0.3); // ~170 m away
      expect(km[2]).toBeGreaterThan(5);
    });

    it('falls back to curated places within 25 km, nearest first, when Google has nothing', async () => {
      const spot = PLACES_CONFIG.popular[0];
      const { service, wiki } = makeService([]); // no key / outage

      const items = await service.getNearby(spot.lat, spot.lng);

      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.id === spot.id)).toBe(true); // standing right on it
      expect(items[0].distanceKm).toBeLessThan(0.1);
      const km = items.map((i) => i.distanceKm as number);
      expect(km).toEqual([...km].sort((a, b) => a - b));
      expect(km.every((d) => d <= 25)).toBe(true);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length); // no duplicates
      expect(wiki.findPhoto).not.toHaveBeenCalled();
    });

    it('returns nothing (and does not call Google) for invalid coordinates', async () => {
      const { service, google } = makeService([hit('x-dddd4444', 1, 1)]);

      expect(await service.getNearby(NaN, 78)).toEqual([]);
      expect(google.searchNearby).not.toHaveBeenCalled();
    });
  });

  describe('getPopular', () => {
    it('adds distanceKm and orders every list nearest-first when the location is known', async () => {
      const { service } = makeService();

      const res = await service.getPopular(RIDER.lat, RIDER.lng);

      for (const list of [res.quickPicks, res.popular, res.cityHighlights]) {
        const km = list.map((p) => p.distanceKm);
        expect(km.every((d) => typeof d === 'number')).toBe(true);
        const nums = km as number[];
        expect(nums).toEqual([...nums].sort((a, b) => a - b));
      }
    });

    it('omits distanceKm when no location is supplied', async () => {
      const { service } = makeService();

      const res = await service.getPopular();

      expect(res.popular.length).toBeGreaterThan(0);
      for (const p of res.popular) expect(p.distanceKm).toBeUndefined();
    });
  });
});
