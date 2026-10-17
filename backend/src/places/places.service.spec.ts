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

function makeService(_unused: unknown[] = [], wikiHits?: unknown[], big: unknown[] = [], popular: unknown[] = []) {
  const google = {
    searchBigPlaces: jest.fn().mockResolvedValue(big),
    searchNearbyByPopularity: jest.fn().mockResolvedValue(popular),
  };
  const wiki = wikiHits ? { searchNearby: jest.fn().mockResolvedValue(wikiHits) } : undefined;
  const service = new PlacesService({} as never, {} as never, google as never, wiki as never);
  return { service, google, wiki };
}

describe('PlacesService — location-based home lists', () => {
  describe('coordinate validation', () => {
    it('returns nothing (and never calls Google) for out-of-range or non-finite coordinates', async () => {
      const { service, google } = makeService([], undefined, [hit('y-eeee5555', 1, 1)], [hit('z-ffff6666', 1, 1)]);
      for (const [lat, lng] of [[91, 78], [-91, 78], [11, 181], [11, -181], [1e9, 1e9], [Infinity, 78], [NaN, 78]]) {
        expect(await service.getBigPlaces(lat, lng)).toEqual([]);
        expect(await service.getPopular(lat, lng)).toEqual([]);
      }
      expect(google.searchBigPlaces).not.toHaveBeenCalled();
      expect(google.searchNearbyByPopularity).not.toHaveBeenCalled();
    });
  });

  describe('getBigPlaces', () => {
    const typed = (id: string, lat: number, lng: number, types: string[], photo = true) => ({
      ...hit(id, lat, lng, null, null, photo ? `places/${id}/photos/p1` : null),
      types,
    });

    it('keeps at most 3 per kind, nearest first, photo only', async () => {
      const { service, google } = makeService([], undefined, [
        typed('c1-aaaa1111', 11.665, 78.147, ['university']),
        typed('c2-bbbb2222', 11.666, 78.148, ['university']),
        typed('c3-cccc3333', 11.667, 78.149, ['university']),
        typed('c4-ffff6666', 11.668, 78.15, ['university']),
        typed('bus-dddd4444', 11.7, 78.16, ['bus_station']),
        typed('nop-eeee5555', 11.664, 78.1461, ['train_station'], false),
      ]);
      const items = await service.getBigPlaces(SALEM.lat, SALEM.lng);
      expect(google.searchBigPlaces).toHaveBeenCalledWith(SALEM.lat, SALEM.lng, 10000);
      expect(items.map((i) => i.id)).toEqual(['g-c1-aaaa1111', 'g-c2-bbbb2222', 'g-c3-cccc3333', 'g-bus-dddd4444']);
    });

    it('has no fixed list and ignores invalid coordinates', async () => {
      const { service, google } = makeService();
      expect(await service.getBigPlaces(SALEM.lat, SALEM.lng)).toEqual([]);
      expect(await service.getBigPlaces(NaN, 1)).toEqual([]);
      expect(google.searchBigPlaces).toHaveBeenCalledTimes(1);
    });

    it('tops up from Wikipedia only with bus/rail/college places', async () => {
      const { service } = makeService([], [
        wikiHit('1', 'Erode Junction railway station', 11.342, 77.718),
        wikiHit('2', 'Some Temple', 11.343, 77.719),
      ]);
      const items = await service.getBigPlaces(ERODE.lat, ERODE.lng);
      expect(items.map((i) => i.id)).toEqual(['w-1']);
    });
  });

  describe('getPopular', () => {
    it('keeps well-rated places with a photo, nearest first', async () => {
      const { service, google } = makeService([], undefined, [], [
        hit('far-aaaa1111', 11.75, 78.2, 4.6, 900),
        hit('near-bbbb2222', 11.665, 78.147, 4.3, 120),
        hit('low-cccc3333', 11.666, 78.147, 3.2, 500),
        hit('few-dddd4444', 11.667, 78.147, 4.8, 3),
        hit('nop-eeee5555', 11.668, 78.147, 4.8, 500, null),
      ]);
      const items = await service.getPopular(SALEM.lat, SALEM.lng);
      expect(google.searchNearbyByPopularity).toHaveBeenCalledWith(SALEM.lat, SALEM.lng, 25000);
      expect(items.map((i) => i.id)).toEqual(['g-near-bbbb2222', 'g-far-aaaa1111']);
    });

    it('returns relative proxy image URLs and distanceKm, never absolute URLs', async () => {
      const { service } = makeService([], undefined, [], [hit('near-bbbb2222', 11.665, 78.147, 4.3, 120)]);
      const [item] = await service.getPopular(SALEM.lat, SALEM.lng);
      expect(item.imageUrl).toBe('/places/photo/g/near-bbbb2222');
      expect(item.imageUrl).not.toMatch(/^https?:/);
      expect(typeof item.distanceKm).toBe('number');
    });

    it('tops up from Wikipedia attractions only', async () => {
      const { service } = makeService([], [
        wikiHit('1', 'Erode Fort', 11.342, 77.718, true),
        wikiHit('2', 'Some Ward', 11.343, 77.719, false),
      ]);
      const items = await service.getPopular(ERODE.lat, ERODE.lng);
      expect(items.map((i) => i.id)).toEqual(['w-1']);
    });

    it('does not repeat a Wikipedia place Google already returned', async () => {
      const { service } = makeService(
        [],
        [wikiHit('111111', 'Place same-gggg7777', 11.3421, 77.7181)],
        [],
        [hit('same-gggg7777', 11.342, 77.718, 4.5, 200)],
      );
      const items = await service.getPopular(ERODE.lat, ERODE.lng);
      expect(items.map((i) => i.id)).toEqual(['g-same-gggg7777']);
    });
  });

  // Home/Work labels: the old label is replaced and the new place saved in ONE
  // transaction, so a failed save can never leave the rider with no Home/Work.
  describe('upsertSaved', () => {
    const makeSaved = (saveImpl?: (e: object) => Promise<object>) => {
      const repo = {
        delete: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((e: object) => e),
        save: jest.fn(saveImpl ?? (async (e: object) => ({ id: 's1', ...e }))),
      };
      const transaction = jest.fn((cb: (m: unknown) => Promise<unknown>) =>
        cb({ getRepository: () => repo }),
      );
      // The outer repository has NO delete/save: using it outside the transaction would throw.
      const outer = { manager: { transaction } };
      const service = new PlacesService(outer as never, {} as never, {} as never);
      return { service, repo, transaction };
    };
    const dto = { title: 'Home', address: 'Erode', lat: 11.341, lng: 77.7172, label: 'home' };

    it('replaces the old label and writes the new place inside ONE transaction', async () => {
      const { service, repo, transaction } = makeSaved();
      const out = await service.upsertSaved('u1', dto as never);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(repo.delete).toHaveBeenCalledWith({ userId: 'u1', label: 'home' });
      expect(out).toMatchObject({ id: 's1', label: 'home', title: 'Home' });
    });

    it('a failed save propagates out of the transaction (so the label delete rolls back)', async () => {
      const { service, repo } = makeSaved(async () => {
        throw new Error('db down');
      });
      await expect(service.upsertSaved('u1', dto as never)).rejects.toThrow('db down');
      expect(repo.delete).toHaveBeenCalled();
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

    it('picks the NEWEST drop-offs: recency ordering happens before the LIMIT', async () => {
      const { service, rides } = makeHistory();

      await service.getRecent('u1');
      const sql = rides.query.mock.calls[0][0] as string;
      // DISTINCT ON must be wrapped so the LIMIT applies after ORDER BY created_at DESC,
      // not after ORDER BY geo_key (which would keep the alphabetically-first places).
      expect(sql).toMatch(/\) latest\s+ORDER BY created_at DESC\s+LIMIT \$2/);
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

    it('only COMPLETED rides count as visits (not cancelled or in-flight ones)', async () => {
      const { service, rides } = makeHistory();
      await service.getFrequent('u1');
      const sql = rides.query.mock.calls[0][0] as string;
      expect(sql).toMatch(/r\.status = 'completed'/);
      expect(sql).not.toMatch(/<> 'cancelled'/);
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
