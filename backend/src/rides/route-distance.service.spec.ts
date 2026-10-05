import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { ROUTE_FALLBACK_FACTOR, RouteDistanceService } from './route-distance.service';

/**
 * R-7 routed-distance tests (HTTP mocked):
 *  - routed ok            -> Mapbox route metres become km
 *  - routed fails         -> straight-line x1.3 fallback (also on no token)
 *  - cache                -> same rounded endpoints hit the cache (10 min)
 *  - outlier flag basis   -> admin.service flags > routed x1.5 (admin spec)
 */
describe('RouteDistanceService (R-7)', () => {
  const pickup = { lat: 12.9, lng: 77.6 };
  const dropoff = { lat: 13.0, lng: 77.5 };
  // ~13.6 km straight-line for the fixture above; assert via haversine rather
  // than a magic number so the fixture can move without touching the maths.
  const straight = (() => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(dropoff.lat - pickup.lat);
    const dLng = toRad(dropoff.lng - pickup.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(pickup.lat)) * Math.cos(toRad(dropoff.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  })();

  let http: { get: jest.Mock };
  let config: { get: jest.Mock };
  let service: RouteDistanceService;

  beforeEach(() => {
    http = { get: jest.fn() };
    config = { get: jest.fn() };
    service = new RouteDistanceService(http as unknown as HttpService, config as unknown as ConfigService);
  });

  it('uses the Mapbox routed distance when the call succeeds', async () => {
    config.get.mockReturnValue('pk.test');
    http.get.mockReturnValue(of({ data: { routes: [{ distance: 18_000 }] } })); // 18 km route

    await expect(service.routedKm(pickup, dropoff)).resolves.toBe(18);

    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('driving/77.6,12.9;77.5,13'),
      expect.objectContaining({ timeout: 3000 }),
    );
  });

  it('falls back to straight-line x1.3 when the call fails', async () => {
    config.get.mockReturnValue('pk.test');
    http.get.mockReturnValue(throwError(() => new Error('ETIMEDOUT')));

    await expect(service.routedKm(pickup, dropoff)).resolves.toBeCloseTo(straight * ROUTE_FALLBACK_FACTOR, 5);
  });

  it('falls back without any HTTP call when MAPBOX_TOKEN is unset', async () => {
    config.get.mockReturnValue(undefined);

    await expect(service.routedKm(pickup, dropoff)).resolves.toBeCloseTo(straight * ROUTE_FALLBACK_FACTOR, 5);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('falls back when the response carries no usable route', async () => {
    config.get.mockReturnValue('pk.test');
    http.get.mockReturnValue(of({ data: { routes: [] } }));

    await expect(service.routedKm(pickup, dropoff)).resolves.toBeCloseTo(straight * ROUTE_FALLBACK_FACTOR, 5);
  });

  it('caches by rounded pickup/dropoff for 10 minutes', async () => {
    config.get.mockReturnValue('pk.test');
    http.get.mockReturnValue(of({ data: { routes: [{ distance: 20_000 }] } }));

    const first = await service.routedKm(pickup, dropoff);
    const second = await service.routedKm({ lat: pickup.lat + 0.0001, lng: pickup.lng }, dropoff);

    expect(first).toBe(20);
    expect(second).toBe(20);
    expect(http.get).toHaveBeenCalledTimes(1); // second read served from cache
  });

  it('returns 0 for identical points (no route worth taking)', async () => {
    await expect(service.routedKm(pickup, pickup)).resolves.toBe(0);
    expect(http.get).not.toHaveBeenCalled();
  });
});
