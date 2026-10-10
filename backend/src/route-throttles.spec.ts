/// <reference types="jest" />
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from './auth/auth.controller';
import { DriversController } from './drivers/drivers.controller';
import { PlacesController } from './places/places.controller';
import { PromosController } from './promos/promos.controller';
import { RidesController } from './rides/rides.controller';

/**
 * SEC-9: route-level throttles, all stricter than the 300 req/min global
 * default (see app.module). The guard reads the per-route metadata written
 * by @Throttle({ default: ... }); this spec pins every sensitive route so a
 * refactor cannot silently drop one back to the global limit.
 */
describe('route-level @Throttle overrides (SEC-9)', () => {
  const ROUTES: Array<{ name: string; handler: object; limit: number }> = [
    // Rides: booking is the expensive mutation; the rest are state changes.
    { name: 'POST /rides (create)', handler: RidesController.prototype.create, limit: 5 },
    { name: 'PATCH /rides/:id/cancel', handler: RidesController.prototype.cancel, limit: 10 },
    { name: 'PATCH /rides/:id/review', handler: RidesController.prototype.review, limit: 10 },
    {
      name: 'PATCH /rides/:id/verify-pickup-otp',
      handler: RidesController.prototype.verifyPickupOtp,
      limit: 10,
    },
    {
      name: 'PATCH /rides/:id/payment-received',
      handler: RidesController.prototype.paymentReceived,
      limit: 10,
    },
    // Promo guessing is a volume game — keep it tiny.
    { name: 'POST /promos/validate', handler: PromosController.prototype.validate, limit: 10 },
    // Driver search walks the driver table; application uploads store bytes.
    { name: 'GET /drivers/nearby', handler: DriversController.prototype.findNearby, limit: 30 },
    { name: 'POST /drivers/apply', handler: DriversController.prototype.apply, limit: 5 },
    // Places: nearby/popular trigger billable server-side Google searches;
    // saved-place writes are DB churn.
    { name: 'GET /places/nearby', handler: PlacesController.prototype.getNearby, limit: 30 },
    { name: 'GET /places/popular', handler: PlacesController.prototype.getPopular, limit: 30 },
    { name: 'POST /places/saved', handler: PlacesController.prototype.upsertSaved, limit: 20 },
    { name: 'DELETE /places/saved/:id', handler: PlacesController.prototype.deleteSaved, limit: 20 },
    // Avatar stores bytes + hits Cloudinary.
    { name: 'POST /auth/me/avatar', handler: AuthController.prototype.uploadAvatar, limit: 5 },
  ];

  it.each(ROUTES)('$name allows at most $limit requests/minute', ({ handler, limit }) => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(limit);
  });

  it.each(ROUTES)('$name counts within a 1-minute window', ({ handler }) => {
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(60_000);
  });

  it('every override is stricter than the 300 req/min global default', () => {
    for (const route of ROUTES) expect(route.limit).toBeLessThan(300);
  });
});
