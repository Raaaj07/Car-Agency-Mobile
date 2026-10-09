/// <reference types="jest" />
import { ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AdminController } from './admin/admin.controller';
import { PlacesController } from './places/places.controller';
import { AdminPromosController } from './promos/admin-promos.controller';
import { RidesController } from './rides/rides.controller';

/**
 * SEC-8: every UUID :id route param runs through ParseUUIDPipe — a malformed
 * id becomes a 400 BEFORE it can reach Postgres (which used to answer 500
 * "invalid input syntax for type uuid"). This pins the wiring: a refactor
 * that drops a pipe fails here, named route by named route. Non-UUID params
 * (photo configId / googlePlaceId, admin document `kind`) are excluded on
 * purpose — they are allow-list / pattern validated in the service.
 *
 * Nest stores ROUTE_ARGS_METADATA on the declaring class (not the prototype)
 * as `{ index, data, pipes }` — pipes holds the transform classes.
 */
describe('ParseUUIDPipe wiring on :id params (SEC-8)', () => {
  type ArgMeta = { index: number; data?: unknown; pipes?: unknown[] };

  const hasUuidPipe = (target: object, method: string, paramIndex: number): boolean => {
    const meta = (Reflect.getMetadata(ROUTE_ARGS_METADATA, target, method) ?? {}) as Record<
      string,
      ArgMeta
    >;
    const arg = Object.values(meta).find((a) => a.index === paramIndex);
    return (arg?.pipes ?? []).some((p) => p === ParseUUIDPipe);
  };

  const expectAll = (target: object, routes: Array<[string, number]>): void => {
    for (const [method, paramIndex] of routes) {
      // [name, ok] pairs so a failure names the exact route.
      expect([method, hasUuidPipe(target, method, paramIndex)]).toEqual([method, true]);
    }
  };

  it('rides controller: every ride :id', () => {
    // Each signature is (user, id[, dto]) — the id is argument 1.
    expectAll(RidesController, [
      ['rematch', 1],
      ['findOne', 1],
      ['accept', 1],
      ['decline', 1],
      ['enRoute', 1],
      ['start', 1],
      ['verifyPickupOtp', 1],
      ['complete', 1],
      ['paymentReceived', 1],
      ['cancel', 1],
      ['review', 1],
    ]);
  });

  it('admin controller: application/driver/ride ids (roles-guarded)', () => {
    expectAll(AdminController, [
      ['getOne', 0], // application id
      ['driverDetail', 0],
      ['rideDetail', 0],
      ['cancelRide', 1],
      ['resolvePayment', 1],
      ['approve', 1],
      ['reject', 1],
      ['suspend', 1],
      ['reinstate', 1],
      ['documents', 0],
      ['getFile', 0], // applicationId (`kind` is DOC_KINDS-validated, not a UUID)
    ]);
  });

  it('places + promos controllers', () => {
    expectAll(PlacesController, [['deleteSaved', 1]]);
    expectAll(AdminPromosController, [
      ['update', 0],
      ['remove', 0],
    ]);
  });
});
