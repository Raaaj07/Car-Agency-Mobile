/// <reference types="jest" />
import { PlacesService } from './places.service';
import { PLACES_CONFIG } from './places.config';

const SALEM = { lat: 11.6643, lng: 78.146 };
const ERODE = { lat: 11.341, lng: 77.7172 };

const hit = (id: string, lat: number, lng: number, rating: number | null = null, ratingCount: number | null = null) => ({
  googlePlaceId: id, title: `Place ${id}`, subtitle: 'India', lat, lng,
  photoName: null, photoAttribution: null, rating, ratingCount,
});

function makeService(near: unknown[] = [], popular: unknown[] = []) {
  const google = {
    searchNearbyByDistance: jest.fn().mockResolvedValue(near),
    searchNearbyByPopularity: jest.fn().mockResolvedValue(popular),
  };
  const service = new PlacesService({} as never, {} as never, google as never);
  return { service, google };
}

describe('PlacesService — location-based suggestions', () => {
  describe('getNearby', () => {
    it('returns nearest first, with distanceKm and proxy image URLs only', async () => {
      const { service } = makeService([
        hit('far-aaaa1111', 11.75, 78.2),
        hit('near-bbbb2222', 11.665, 78.1465),
        hit('mid-cccc3333', 11.7, 78.16),
      ]);
      const items = await service.getNearby(SALEM.lat, SALEM.lng);
      expect(items.map((i) => i.id)).toEqual(['g-near-bbbb2222', 'g-mid-cccc3333', 'g-far-aaaa1111']);
      const km = items.map((i) => i.distanceKm as number);
      expect(km).toEqual([...km].sort((a, b) => a - b));
      for (const i of items) {
        expect(i.imageUrl).toBe(`/places/photo/g/${i.id.slice(2)}`);
        expect(i.imageUrl).not.toMatch(/^https?:/);
      }
    });

    it('searches 5 km by default and never more than 10 km', async () => {
      const { service, google } = makeService([hit('x-dddd4444', 11.665, 78.147)]);
      await service.getNearby(SALEM.lat, SALEM.lng);
      expect(google.searchNearbyByDistance).toHaveBeenLastCalledWith(SALEM.lat, SALEM.lng, 5000);
      await service.getNearby(SALEM.lat, SALEM.lng, 40000);
      expect(google.searchNearbyByDistance).toHaveBeenLastCalledWith(SALEM.lat, SALEM.lng, 10000);
    });

    it('falls back to curated spots within the radius when Google has nothing', async () => {
      const spot = PLACES_CONFIG.popular[0];
      const { service } = makeService([]);
      const items = await service.getNearby(spot.lat, spot.lng);
      expect(items.some((i) => i.id === spot.id)).toBe(true);
      expect(items.every((i) => (i.distanceKm as number) <= 5)).toBe(true);
    });

    it('shows no Salem spots to a rider in Erode when Google has nothing', async () => {
      const { service } = makeService([]);
      expect(await service.getNearby(ERODE.lat, ERODE.lng)).toEqual([]);
    });

    it('returns nothing (and does not call Google) for invalid coordinates', async () => {
      const { service, google } = makeService([hit('x-dddd4444', 1, 1)]);
      expect(await service.getNearby(NaN, 78)).toEqual([]);
      expect(google.searchNearbyByDistance).not.toHaveBeenCalled();
    });
  });

  describe('getPopular', () => {
    it('keeps only well-rated live places, nearest first, searched out to 50 km', async () => {
      const { service, google } = makeService([], [
        hit('far-aaaa1111', 11.6, 77.9, 4.6, 900),
        hit('near-bbbb2222', 11.35, 77.72, 4.2, 300),
        hit('lowstar-cccc3', 11.34, 77.71, 3.4, 900),
        hit('fewrate-dddd4', 11.34, 77.72, 4.8, 3),
        hit('norating-eeee5', 11.34, 77.72),
      ]);
      const res = await service.getPopular(ERODE.lat, ERODE.lng);
      expect(google.searchNearbyByPopularity).toHaveBeenCalledWith(ERODE.lat, ERODE.lng, 50000);
      expect(res.popular.map((p) => p.id)).toEqual(['g-near-bbbb2222', 'g-far-aaaa1111']);
      expect(res.popular[0].rating).toBe(4.2);
      expect(res.popular[0].imageUrl).toBe('/places/photo/g/near-bbbb2222');
    });

    it('shows no curated Salem spots to a rider in Erode', async () => {
      const { service } = makeService([], [hit('near-bbbb2222', 11.35, 77.72, 4.5, 100)]);
      const res = await service.getPopular(ERODE.lat, ERODE.lng);
      expect(res.quickPicks).toEqual([]);
      expect(res.cityHighlights).toEqual([]);
      expect(res.popular.some((p) => !p.id.startsWith('g-'))).toBe(false);
    });

    it('includes curated spots for a rider actually near them, nearest first', async () => {
      const { service } = makeService([], []);
      const res = await service.getPopular(SALEM.lat, SALEM.lng);
      expect(res.popular.length).toBeGreaterThan(0);
      const km = res.popular.map((p) => p.distanceKm as number);
      expect(km).toEqual([...km].sort((a, b) => a - b));
      expect(km.every((d) => d <= 50)).toBe(true);
      expect(res.quickPicks.length).toBeGreaterThan(0);
    });

    it('drops a curated spot that duplicates a live result', async () => {
      const spot = PLACES_CONFIG.popular[0];
      const { service } = makeService([], [hit('same-ffff6666', spot.lat, spot.lng, 4.5, 500)]);
      const res = await service.getPopular(SALEM.lat, SALEM.lng);
      expect(res.popular.some((p) => p.id === spot.id)).toBe(false);
      expect(res.popular.some((p) => p.id === 'g-same-ffff6666')).toBe(true);
    });

    it('returns curated lists unfiltered, without distances, when no location is supplied', async () => {
      const { service, google } = makeService();
      const res = await service.getPopular();
      expect(res.popular.length).toBe(PLACES_CONFIG.popular.length);
      for (const p of res.popular) expect(p.distanceKm).toBeUndefined();
      expect(google.searchNearbyByPopularity).not.toHaveBeenCalled();
    });
  });

  // SEC-5: input clamps — a non-numeric ?limit used to reach `LIMIT $2` as
  // NaN (every NaN comparison is false, so the 1..10 clamp passed it) and
  // surfaced as a 500.
  describe('getRecent', () => {
    const makeRecent = () => {
      const rides = { query: jest.fn().mockResolvedValue([]) };
      const savedPlaces = {
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        }),
      };
      const service = new PlacesService(savedPlaces as never, rides as never, {} as never);
      return { service, rides };
    };

    it('a non-numeric limit never reaches SQL as NaN (was a LIMIT NaN 500)', async () => {
      const { service, rides } = makeRecent();

      expect(await service.getRecent('u1', Number.NaN)).toEqual([]);
      expect(rides.query).toHaveBeenCalledWith(expect.any(String), ['u1', 15]); // default 5 x 3
    });

    it('clamps the limit into the 1..10 window', async () => {
      const { service, rides } = makeRecent();

      await service.getRecent('u1', 9999);
      expect(rides.query).toHaveBeenLastCalledWith(expect.any(String), ['u1', 30]); // 10 x 3

      await service.getRecent('u1', -3);
      expect(rides.query).toHaveBeenLastCalledWith(expect.any(String), ['u1', 3]); // 1 x 3
    });
  });
});