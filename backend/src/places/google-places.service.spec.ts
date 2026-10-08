/// <reference types="jest" />
import {
  GooglePlacesService,
  NEAR_INCLUDED_TYPES,
  POPULAR_INCLUDED_TYPES,
} from './google-places.service';

// Types verified as Places API (New) "Table A" — the ONLY types Nearby Search
// accepts in `includedTypes`. Table B types (place_of_worship, establishment,
// food, health, ...) may appear in responses but make Google answer
// HTTP 400 INVALID_ARGUMENT for the whole request, which silently emptied both
// home-screen lists. If you add a type, check it against:
// https://developers.google.com/maps/documentation/places/web-service/place-types
const TABLE_A_TYPES_WE_USE = new Set([
  'tourist_attraction',
  'museum',
  'park',
  'zoo',
  'amusement_park',
  'stadium',
  'shopping_mall',
  'university',
  'hospital',
  'transit_station',
  'bus_station',
  'train_station',
  'hindu_temple',
  'church',
  'mosque',
  'restaurant',
  'school',
  'art_gallery',
]);

const TABLE_B_ONLY = ['place_of_worship', 'establishment', 'food', 'health', 'finance', 'geocode', 'landmark'];

describe('GooglePlacesService — Nearby Search request', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('only uses Table A place types (Table B types make Google reject the whole request)', () => {
    for (const list of [NEAR_INCLUDED_TYPES, POPULAR_INCLUDED_TYPES]) {
      for (const type of list) {
        expect(TABLE_B_ONLY).not.toContain(type);
        expect(TABLE_A_TYPES_WE_USE.has(type)).toBe(true);
      }
    }
  });

  it.each([
    ['searchNearbyByDistance', 'DISTANCE', NEAR_INCLUDED_TYPES],
    ['searchNearbyByPopularity', 'POPULARITY', POPULAR_INCLUDED_TYPES],
  ] as const)('%s sends rankPreference %s with the matching included types', async (method, rank, types) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new GooglePlacesService({ get: () => 'test-key' } as never);

    await service[method](11.341, 77.7172);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.rankPreference).toBe(rank);
    expect(body.includedTypes).toEqual(types);
    expect(body.locationRestriction.circle.center).toEqual({ latitude: 11.341, longitude: 77.7172 });
  });

  it('parses hits and remembers them for the photo proxy; an HTTP error yields []', async () => {
    const ok = {
      ok: true,
      json: async () => ({
        places: [
          {
            id: 'ChIJabcdefgh1234',
            displayName: { text: 'Kasthuri Ranga Temple' },
            formattedAddress: 'Erode, Tamil Nadu',
            location: { latitude: 11.34, longitude: 77.72 },
            photos: [{ name: 'places/ChIJabcdefgh1234/photos/xyz' }],
            rating: 4.6,
            userRatingCount: 812,
          },
        ],
      }),
    };
    global.fetch = jest.fn().mockResolvedValue(ok) as unknown as typeof fetch;
    const service = new GooglePlacesService({ get: () => 'test-key' } as never);

    const hits = await service.searchNearbyByPopularity(11.341, 77.7172);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ rating: 4.6, ratingCount: 812, photoName: 'places/ChIJabcdefgh1234/photos/xyz' });
    expect(service.getKnownPlace('ChIJabcdefgh1234')?.title).toBe('Kasthuri Ranga Temple');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Unsupported types' } }),
    }) as unknown as typeof fetch;
    const failing = new GooglePlacesService({ get: () => 'test-key' } as never);
    expect(await failing.searchNearbyByDistance(11.341, 77.7172)).toEqual([]);
  });

  it('returns [] without calling Google when no API key is configured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new GooglePlacesService({ get: () => undefined } as never);

    expect(await service.searchNearbyByDistance(11.341, 77.7172)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
