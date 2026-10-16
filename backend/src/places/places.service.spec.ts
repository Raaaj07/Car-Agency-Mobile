/// <reference types="jest" />
import { PlacesService } from './places.service';

const SALEM = { lat: 11.6643, lng: 78.146 };
const ERODE = { lat: 11.341, lng: 77.7172 };

// Google hits carry a photo by default: places without one are never returned.
const hit = (
  id: string,
  lat: number,
  lng: number,
  rating: number | null = null,
  ratingCount: number | null = null,
  photoName: string | null = `places/${id}/photos/p1`,
) => ({
  googlePlaceId: id, title: `Place ${id}`, subtitle: 'India', lat, lng,
  photoName, photoAttribution: null, rating, ratingCount,
});

const wikiHit = (pageId: string, title: string, lat: number, lng: number, attraction = true) => ({
  pageId, title, description: `${title}, India`, lat, lng,
  thumbUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/${pageId}.jpg`, attraction,
});

function makeService(near: unknown[] = [], wikiHits?: unknown[]) {
  const google = {
    searchNearbyByDistance: jest.fn().mockResolvedValue(near),
  };
  const wiki = wikiHits ? { searchNearby: jest.fn().mockResolvedValue(wikiHits) } : undefined;
  const service = new PlacesService({} as never, {} as never, google as never, wiki as never);
  return { service, google, wiki };
}

describe('PlacesService — nearest places', () => {
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

    it('has NO fixed fallback list: nothing from Google or Wikipedia means nothing', async () => {
      const { service } = makeService([]);
      expect(await service.getNearby(SALEM.lat, SALEM.lng)).toEqual([]);
      expect(await service.getNearby(ERODE.lat, ERODE.lng)).toEqual([]);
    });

    it('drops Google places that have no photo', async () => {
      const { service } = makeService([
        hit('nophoto-aaaa1111', 11.665, 78.1465, null, null, null),
        hit('photo-bbbb2222', 11.666, 78.147),
      ]);
      const items = await service.getNearby(SALEM.lat, SALEM.lng);
      expect(items.map((i) => i.id)).toEqual(['g-photo-bbbb2222']);
    });

    it('tops up from Wikipedia (photo-proxy URLs) when Google has too few places with photos', async () => {
      const { service, wiki } = makeService([], [
        wikiHit('111111', 'Erode Fort', 11.342, 77.718),
        wikiHit('222222', 'Kaveri College', 11.35, 77.73, false),
      ]);
      const items = await service.getNearby(ERODE.lat, ERODE.lng);
      expect(wiki!.searchNearby).toHaveBeenCalled();
      expect(items.map((i) => i.id)).toEqual(['w-111111', 'w-222222']);
      expect(items[0].imageUrl).toBe('/places/photo/w/111111');
      expect(items[0].imageUrl).not.toMatch(/^https?:/);
    });

    it('does not repeat a Wikipedia place Google already returned', async () => {
      const { service } = makeService(
        [hit('same-gggg7777', 11.342, 77.718)],
        [wikiHit('111111', 'Place same-gggg7777', 11.3421, 77.7181)],
      );
      const items = await service.getNearby(ERODE.lat, ERODE.lng);
      expect(items.map((i) => i.id)).toEqual(['g-same-gggg7777']);
    });

    it('returns nothing (and does not call Google) for invalid coordinates', async () => {
      const { service, google } = makeService([hit('x-dddd4444', 1, 1)]);
      expect(await service.getNearby(NaN, 78)).toEqual([]);
      expect(google.searchNearbyByDistance).not.toHaveBeenCalled();
    });
  });

  const makeHistory = (rows: unknown[] = []) => {
    const rides = { query: jest.fn().mockResolvedValue(rows) };
    const savedPlaces = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };
    const service = new PlacesService(savedPlaces as never, rides as never, {} as never);
    return { service, rides };
  };

  // SEC-5: input clamps — a non-numeric ?limit used to reach `LIMIT $2` as
  // NaN (every NaN comparison is false, so the 1..10 clamp passed it) and
  // surfaced as a 500.
  describe('getRecent', () => {
    it('a non-numeric limit never reaches SQL as NaN (was a LIMIT NaN 500)', async () => {
      const { service, rides } = makeHistory();

      expect(await service.getRecent('u1', Number.NaN)).toEqual([]);
      expect(rides.query).toHaveBeenCalledWith(expect.any(String), ['u1', 15]); // default 5 x 3
    });

    it('clamps the limit into the 1..10 window', async () => {
      const { service, rides } = makeHistory();

      await service.getRecent('u1', 9999);
      expect(rides.query).toHaveBeenLastCalledWith(expect.any(String), ['u1', 30]); // 10 x 3

      await service.getRecent('u1', -3);
      expect(rides.query).toHaveBeenLastCalledWith(expect.any(String), ['u1', 3]); // 1 x 3
    });

    it('never attaches a hardcoded photo to a recent drop-off', async () => {
      const { service } = makeHistory([
        { geo_key: '11.6625,78.1473', title: 'Somewhere', addr: 'Somewhere, Salem', lat: 11.6625, lng: 78.1473, created_at: new Date() },
      ]);
      const [item] = await service.getRecent('u1');
      expect(item.imageUrl).toBeNull();
    });
  });

  describe('getFrequent', () => {
    it('maps the most-visited drop-offs with their visit counts, in the order the query returns', async () => {
      const { service, rides } = makeHistory([
        { geo_key: '11.3410,77.7172', visits: 7, addr: 'Erode Bus Stand, Erode, Tamil Nadu', lat: 11.341, lng: 77.7172 },
        { geo_key: '11.6643,78.1460', visits: 3, addr: 'Home, Salem', lat: 11.6643, lng: 78.146 },
      ]);
      const items = await service.getFrequent('u1');
      expect(items.map((i) => i.id)).toEqual(['frequent-11.3410,77.7172', 'frequent-11.6643,78.1460']);
      expect(items.map((i) => i.visitCount)).toEqual([7, 3]);
      expect(items[0].title).toBe('Erode Bus Stand');
      expect(items[0].subtitle).toBe('Erode Bus Stand, Erode, Tamil Nadu');
      expect(items.every((i) => i.imageUrl === null)).toBe(true);
      // rider id, minimum visits (2), limit (5)
      expect(rides.query).toHaveBeenCalledWith(expect.any(String), ['u1', 2, 5]);
    });

    it('a new rider with no repeat trips gets an empty list', async () => {
      const { service } = makeHistory([]);
      expect(await service.getFrequent('u1')).toEqual([]);
    });

    it('clamps the limit into 1..10 and ignores NaN', async () => {
      const { service, rides } = makeHistory();
      await service.getFrequent('u1', Number.NaN);
      expect(rides.query).toHaveBeenLastCalledWith(expect.any(String), ['u1', 2, 5]);
      await service.getFrequent('u1', 500);
      expect(rides.query).toHaveBeenLastCalledWith(expect.any(String), ['u1', 2, 10]);
      await service.getFrequent('u1', -1);
      expect(rides.query).toHaveBeenLastCalledWith(expect.any(String), ['u1', 2, 1]);
    });
  });
});
