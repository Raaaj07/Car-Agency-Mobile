import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { FakeRedis } from '../test/fake-redis';
import { RIDE_TIMERS_KEY, RidesService } from './rides.service';
import { RideEntity } from './entities/ride.entity';
import { PaymentEntity } from '../payments/entities/payment.entity';
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';
import { DriversService } from '../drivers/drivers.service';
import { GeoService } from '../drivers/geo.service';
import { RidesGateway } from './gateway/rides.gateway';
import { PromosService } from '../promos/promos.service';
import { RouteDistanceService } from './route-distance.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Phase-1 regression tests:
 *  R-1 — a "no drivers nearby" search arms a server-side window that
 *        auto-cancels the ride (and the stale sweep covers abandoned ones).
 *  R-2 — a foreign cancel gets 403 WITHOUT killing the offer timer.
 *  P-1 — only the driver can settle a ride; disputed blocks confirmation.
 *  R-5 — timers live in the Redis `ride:timers` zset: they survive restarts,
 *        and the atomic ZREM claim gives exactly one winner per timer.
 */
type RidesInternals = {
  matchNearestDriver(ride: RideEntity): Promise<{ status: 'offered' | 'no_drivers'; candidates: number }>;
  scheduleOfferTimeout(rideId: string, timeoutMs: number): Promise<void>;
  sweepDueTimers(nowMs?: number): Promise<number>;
};

type QueryRunnerStub = {
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  manager: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
};

describe('RidesService phase-1 fixes', () => {
  let service: RidesService;
  let internals: RidesInternals;
  let rides: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    manager: {
      connection: { createQueryRunner: jest.Mock };
      update: jest.Mock;
      findOne: jest.Mock;
      save: jest.Mock;
    };
  };
  let drivers: Record<string, jest.Mock>;
  let gateway: Record<string, jest.Mock>;
  let queryRunner: QueryRunnerStub;
  let promos: Record<string, jest.Mock>;
  // Shared "Redis server" — extra service instances in a test join the same
  // FakeRedis to model multiple backend processes (R-5).
  let fake: FakeRedis;

  const buildService = (
    configValues: Record<string, unknown> = {},
    routedKm = 5,
    settings?: Pick<SettingsService, 'getSearchRadiusMeters'>,
  ): RidesService =>
    new RidesService(
      rides as unknown as Repository<RideEntity>,
      drivers as unknown as DriversService,
      { removeDriver: jest.fn().mockResolvedValue(undefined), upsertDriverLocation: jest.fn().mockResolvedValue(undefined) } as unknown as GeoService,
      gateway as unknown as RidesGateway,
      { get: jest.fn((key: string) => configValues[key]) } as unknown as ConfigService,
      promos as unknown as PromosService,
      // R-7: routed distance — tests use a fixed estimate (no HTTP).
      { routedKm: jest.fn().mockResolvedValue(routedKm) } as unknown as RouteDistanceService,
      fake as unknown as Redis,
      undefined, // push
      settings as unknown as SettingsService | undefined,
    );

  const requestedRide = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    riderId: 'u1',
    driverId: null as string | null,
    status: 'requested',
    vehicleType: 'auto',
    declinedDriverIds: [],
    pickupOtp: '1234',
    otpAttempts: 0,
    pickup: { address: 'Point A', lat: 12.9, lng: 77.6 },
    dropoff: { address: 'Point B', lat: 13.0, lng: 77.5 },
    fareBreakdown: { baseFare: 100, distanceFare: 80, timeCharge: 32, tollFee: 0, taxes: 28, discount: 0, total: 240 },
    paymentMethod: 'upi',
    paymentStatus: 'pending' as 'pending' | 'rider_claimed' | 'paid' | 'disputed' | 'failed',
    paymentMarkedBy: null as 'rider' | 'driver' | 'admin' | 'provider' | null,
    tipAmount: 0,
    cancellationReason: null,
    cancelledBy: null,
    ...overrides,
  });

  /**
   * Makes the lock-manager UPDATE behave like a real one: applies the patch
   * to the ride object, so the post-commit reload and a second locked call
   * see the new state (pass-4 task-2 tests).
   */
  const applyLockUpdates = (ride: Record<string, unknown>) => {
    queryRunner.manager.update.mockImplementation(async (_entity, _where, patch) => {
      Object.assign(ride, patch);
      return { affected: 1 };
    });
  };

  beforeEach(() => {
    rides = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (r) => r),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((r) => r),
      count: jest.fn().mockResolvedValue(0),
      manager: {
        connection: {
          createQueryRunner: jest.fn(),
        },
        // markPaymentReceived settles the PaymentEntity rows through this.
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        // pass-4 task-6: fraud-flag audit rows (dedup lookup + write).
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue({}),
      },
    };
    drivers = {
      findByUserId: jest.fn(),
      findById: jest.fn().mockRejectedValue(new Error('driver not loaded')),
      findNearby: jest.fn().mockResolvedValue([]),
      setAvailability: jest.fn().mockResolvedValue(undefined),
      // RACE: atomic availability claim; default = this caller wins.
      claimAvailability: jest.fn().mockResolvedValue(true),
      applyRating: jest.fn().mockResolvedValue(undefined),
    };
    gateway = {
      emitRideStatus: jest.fn(),
      emitRideRequestToDriver: jest.fn(),
      emitDriverStatus: jest.fn(),
    };

    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        findOne: jest.fn(),
        save: jest.fn(async (r) => r),
        // lock-manager UPDATE: resolves affected without touching any object;
        // tests that model the locked row call applyLockUpdates(ride).
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      },
    };
    (rides.manager.connection.createQueryRunner as jest.Mock).mockReturnValue(queryRunner);

    promos = {
      discountFor: jest.fn().mockResolvedValue(0),
      resolveDiscount: jest.fn().mockResolvedValue(0),
      recordRedemption: jest.fn().mockResolvedValue(undefined),
      // SEC-9: the locked booking gate — tests assert through this handle.
      assertBookable: jest.fn().mockResolvedValue(0),
    };

    fake = new FakeRedis();
    service = buildService();
    internals = service as unknown as RidesInternals;
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('R-1: search timeout for no-drivers bookings', () => {
    it('arms a search window and auto-cancels with no_drivers_available', async () => {
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([]); // nobody nearby at any strategy
      rides.findOne.mockResolvedValue(ride);

      const match = await internals.matchNearestDriver(ride as unknown as RideEntity);

      expect(match).toEqual({ status: 'no_drivers', candidates: 0 });
      // R-5: the window lives in Redis, not in a local setTimeout.
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).not.toBeNull();

      // Window elapsed → the 5 s sweep claims the due member and fires it.
      // Pass-4: the search timeout now runs under the ride row lock.
      queryRunner.manager.findOne.mockResolvedValue(ride);
      applyLockUpdates(ride);
      expect(await internals.sweepDueTimers(Date.now() + 90_001)).toBe(1);

      expect(ride.status).toBe('cancelled');
      expect(ride.cancellationReason).toBe('no_drivers_available');
      expect(ride.cancelledBy).toBe('system');
      expect(gateway.emitRideStatus).toHaveBeenCalledWith(
        'r1',
        'u1',
        null,
        expect.objectContaining({ status: 'cancelled' }),
      );
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).toBeNull(); // claimed away
    });

    it('does not cancel the search once a driver has been offered', async () => {
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([]);
      rides.findOne.mockResolvedValue(ride);

      await internals.matchNearestDriver(ride as unknown as RideEntity);
      // A driver appeared before the window elapsed (offer made elsewhere).
      ride.driverId = 'drv-1';
      queryRunner.manager.findOne.mockResolvedValue(ride); // locked read sees the offer

      await internals.sweepDueTimers(Date.now() + 90_001);

      expect(ride.status).toBe('requested');
      expect(rides.update).not.toHaveBeenCalled();
      expect(queryRunner.manager.update).not.toHaveBeenCalled(); // locked write refused too
      expect(gateway.emitRideStatus).not.toHaveBeenCalled();
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).toBeNull(); // claimed, no-op
    });

    it('sweep cancels requested rides that nobody has offered for 5 minutes', async () => {
      const stale = requestedRide({
        id: 'r2',
        updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      });
      rides.find
        .mockResolvedValueOnce([]) // matched/driver_en_route
        .mockResolvedValueOnce([]) // in_progress
        .mockResolvedValueOnce([stale]); // abandoned searches

      const cancelled = await service.sweepStaleRides(new Date());

      expect(cancelled).toBe(1);
      expect(rides.update).toHaveBeenCalledWith(
        // Pass-4: the condition now pins the driver too, so a re-offer to a
        // different driver between find() and update() is never cancelled.
        { id: 'r2', status: 'requested', driverId: IsNull() },
        expect.objectContaining({
          status: 'cancelled',
          cancelledBy: 'system',
          cancellationReason: 'no_drivers_available',
        }),
      );
      expect(stale.status).toBe('cancelled');
    });
  });

  describe('R-2: cancel ownership vs offer timer', () => {
    it('a foreign cancel gets 403 and leaves the offer timer armed', async () => {
      await internals.scheduleOfferTimeout('r1', 15_000);
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).not.toBeNull();

      queryRunner.manager.findOne.mockResolvedValue(requestedRide({ riderId: 'owner' }));
      drivers.findByUserId.mockRejectedValue(new Error('not a driver'));

      await expect(
        service.cancel('r1', 'intruder', 'rider', { reason: 'not mine to cancel' }),
      ).rejects.toThrow(ForbiddenException);

      // Regression guard: the timer must survive a rejected (foreign) cancel,
      // otherwise the offered driver stays isAvailable=false forever.
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).not.toBeNull();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('the owning rider cancels inside a locked transaction and timers die', async () => {
      await internals.scheduleOfferTimeout('r1', 15_000);
      // A search window is armed too, so we can prove cancel drops BOTH.
      await fake.zadd(RIDE_TIMERS_KEY, Date.now() + 90_000, 'search:r1');
      const ride = requestedRide({ riderId: 'owner' });
      queryRunner.manager.findOne.mockResolvedValue(ride);
      rides.findOne.mockResolvedValue(ride);

      const result = await service.cancel('r1', 'owner', 'rider', { reason: 'rider changed mind' });

      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled', cancelledBy: 'rider' }),
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      // R-5: cancel drops BOTH members of the shared timer set.
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).toBeNull();
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).toBeNull();
      expect(result.status).toBe('cancelled');
    });

    it('rejects cancelling a completed ride', async () => {
      queryRunner.manager.findOne.mockResolvedValue(
        requestedRide({ riderId: 'owner', status: 'completed' }),
      );

      await expect(
        service.cancel('r1', 'owner', 'rider', { reason: 'too late to cancel' }),
      ).rejects.toThrow(BadRequestException);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    it('double-tap: cancelling a ride the same rider ALREADY cancelled succeeds (no 400, no second write)', async () => {
      const ride = requestedRide({ riderId: 'owner', status: 'cancelled', cancelledBy: 'rider' });
      queryRunner.manager.findOne.mockResolvedValue(ride);
      rides.findOne.mockResolvedValue(ride);

      const result = await service.cancel('r1', 'owner', 'rider', { reason: 'second tap' });

      expect(result.status).toBe('cancelled');
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(drivers.setAvailability).not.toHaveBeenCalled(); // nothing freed twice
    });

    it('a ride the SYSTEM cancelled still answers 400 to a rider cancel', async () => {
      queryRunner.manager.findOne.mockResolvedValue(
        requestedRide({ riderId: 'owner', status: 'cancelled', cancelledBy: 'system' }),
      );

      await expect(
        service.cancel('r1', 'owner', 'rider', { reason: 'too late to cancel' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('SEC-11: a failed COMMIT keeps the timers armed (Redis cannot roll back)', async () => {
      await internals.scheduleOfferTimeout('r1', 15_000);
      await fake.zadd(RIDE_TIMERS_KEY, Date.now() + 90_000, 'search:r1');
      queryRunner.manager.findOne.mockResolvedValue(requestedRide({ riderId: 'owner' }));
      queryRunner.commitTransaction.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.cancel('r1', 'owner', 'rider', { reason: 'rider changed mind' }),
      ).rejects.toThrow('db down');

      // The Postgres write rolled back, so the ride is still active — its
      // timers must survive too (they used to be cleared inside the
      // transaction, which Redis cannot roll back with it).
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).not.toBeNull();
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).not.toBeNull();
      expect(drivers.setAvailability).not.toHaveBeenCalled();
    });
  });

  // Admin-configured radius: ONE radius limits who is offered a ride, the
  // nearest driver inside it is offered first, and each decline / timeout
  // moves on to the next nearest until the radius is exhausted.
  describe('radius-based nearest-first matching', () => {
    const hit = (driverId: string, distanceMeters: number) => ({
      driverId,
      userId: `u-${driverId}`,
      distanceMeters,
    });

    it('searches with the admin radius, once, for the requested vehicle type', async () => {
      const settings = { getSearchRadiusMeters: jest.fn().mockResolvedValue(7_000) };
      service = buildService({}, 5, settings);
      internals = service as unknown as RidesInternals;
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([]);

      await internals.matchNearestDriver(ride as unknown as RideEntity);

      expect(drivers.findNearby).toHaveBeenCalledTimes(1); // no 2x widening
      expect(drivers.findNearby).toHaveBeenCalledWith(12.9, 77.6, 7_000, 'auto');
    });

    it('offers the NEAREST driver first and skips drivers who already declined', async () => {
      const ride = requestedRide({ declinedDriverIds: ['declined'] });
      drivers.findNearby.mockResolvedValue([
        hit('far', 900),
        hit('near', 200),
        hit('declined', 50), // closest, but already declined/timed out
      ]);
      drivers.findById.mockResolvedValue({ id: 'near', userId: 'u-near' });
      rides.findOne.mockResolvedValue(ride);

      const result = await internals.matchNearestDriver(ride as unknown as RideEntity);

      expect(result).toEqual({ status: 'offered', candidates: 2 });
      expect(ride.driverId).toBe('near');
      // The offer is claimed atomically (true -> false); the old unconditional
      // setAvailability(false) let two bookings claim the same driver.
      expect(drivers.claimAvailability).toHaveBeenCalledWith('near', undefined);
      expect(drivers.setAvailability).not.toHaveBeenCalledWith('near', false);
      // Only that one driver is contacted.
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledTimes(1);
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledWith(
        'u-near',
        expect.objectContaining({ rideId: 'r1' }),
      );
      // The offer timer is armed so an unanswered offer passes to the next one.
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).not.toBeNull();
    });

    it('skips a driver another booking already claimed and offers the next nearest', async () => {
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([hit('near', 200), hit('next', 600)]);
      // A concurrent booking won the atomic claim on `near`.
      drivers.claimAvailability.mockImplementation(async (id: string) => id !== 'near');
      drivers.findById.mockResolvedValue({ id: 'next', userId: 'u-next' });
      rides.findOne.mockResolvedValue(ride);

      const result = await internals.matchNearestDriver(ride as unknown as RideEntity);

      expect(result).toEqual({ status: 'offered', candidates: 2 });
      expect(ride.driverId).toBe('next');
      expect(drivers.claimAvailability).toHaveBeenNthCalledWith(1, 'near', undefined);
      expect(drivers.claimAvailability).toHaveBeenNthCalledWith(2, 'next', undefined);
      // The already-claimed driver is never contacted.
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledTimes(1);
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledWith(
        'u-next',
        expect.objectContaining({ rideId: 'r1' }),
      );
    });

    it('treats a fully-claimed candidate list as no drivers and keeps searching', async () => {
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([hit('near', 200), hit('next', 600)]);
      drivers.claimAvailability.mockResolvedValue(false);

      const result = await internals.matchNearestDriver(ride as unknown as RideEntity);

      expect(result).toEqual({ status: 'no_drivers', candidates: 0 });
      expect(ride.driverId).toBeNull();
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();
      // The search window is re-armed, so the rider is not stuck forever.
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).not.toBeNull();
    });

    it('releases the atomic claim when the ride save is rejected', async () => {
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([hit('near', 200)]);
      rides.save.mockRejectedValueOnce({ code: '23505' }); // per-driver index

      await expect(internals.matchNearestDriver(ride as unknown as RideEntity)).rejects.toBeDefined();

      // The driver must not stay unavailable after a failed offer.
      expect(drivers.setAvailability).toHaveBeenCalledWith('near', true);
    });

    it('an unanswered offer moves on to the next nearest driver', async () => {
      const ride = requestedRide({ driverId: 'near' });
      queryRunner.manager.findOne.mockResolvedValue(ride);
      applyLockUpdates(ride);
      rides.findOne.mockResolvedValue(ride);
      // After the timeout the nearest is in the declined list; only `next` is left.
      drivers.findNearby.mockResolvedValue([hit('near', 200), hit('next', 600)]);
      drivers.findById.mockResolvedValue({ id: 'next', userId: 'u-next' });
      // rematch() reads the ride under the row lock again.
      queryRunner.manager.findOne.mockResolvedValue(ride);

      await internals.scheduleOfferTimeout('r1', 15_000);
      await internals.sweepDueTimers(Date.now() + 16_000);

      expect(ride.declinedDriverIds).toContain('near');
      expect(drivers.setAvailability).toHaveBeenCalledWith('near', true); // freed
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledWith(
        'u-next',
        expect.objectContaining({ rideId: 'r1' }),
      );
    });

    it('keeps trying until the attempt limit, then cancels with no_drivers_available', async () => {
      drivers.findNearby.mockResolvedValue([]); // radius exhausted

      const nine = requestedRide({ declinedDriverIds: Array.from({ length: 9 }, (_, i) => `d${i}`) });
      await internals.matchNearestDriver(nine as unknown as RideEntity);
      expect(nine.status).toBe('requested'); // still searching (search window armed)
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).not.toBeNull();

      const ten = requestedRide({ declinedDriverIds: Array.from({ length: 10 }, (_, i) => `d${i}`) });
      await internals.matchNearestDriver(ten as unknown as RideEntity);
      expect(ten.status).toBe('cancelled');
      expect(ten.cancellationReason).toBe('no_drivers_available');
    });
  });

  describe('SEC-3: no free rides by cancelling mid-trip', () => {
    const inProgressRide = (overrides: Record<string, unknown> = {}) =>
      requestedRide({
        driverId: 'drv-1',
        status: 'in_progress',
        ...overrides,
      });

    it('a rider cannot cancel a trip that is already in progress (409)', async () => {
      queryRunner.manager.findOne.mockResolvedValue(inProgressRide({ riderId: 'owner' }));
      // The ride has a driver: cancel() asks whether the caller ALSO owns it.
      drivers.findByUserId.mockResolvedValue(null);

      await expect(
        service.cancel('r1', 'owner', 'rider', { reason: 'arrived, not paying' }),
      ).rejects.toThrow(ConflictException);

      // Nothing committed: the ride stays in_progress and the driver's
      // complete() keeps working — the free-ride path is gone.
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('a driver may end an in-progress trip only with a stated reason', async () => {
      queryRunner.manager.findOne.mockResolvedValue(inProgressRide({ riderId: 'owner' }));
      drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'driver-u' });

      await expect(
        service.cancel('r1', 'driver-u', 'driver', { reason: '   ' }),
      ).rejects.toThrow(BadRequestException);

      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('a driver in-progress cancel commits TOGETHER with its review flag', async () => {
      const ride = inProgressRide({ riderId: 'owner' });
      queryRunner.manager.findOne.mockResolvedValue(ride);
      drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'driver-u' });
      rides.findOne.mockResolvedValue(ride); // response reload

      const result = await service.cancel('r1', 'driver-u', 'driver', {
        reason: 'engine trouble mid-trip',
      });

      // The audit row is saved through the SAME transaction as the cancel:
      // no flag, no commit.
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        AdminAuditLogEntity,
        expect.objectContaining({
          action: 'ride_cancel',
          targetType: 'ride',
          targetId: 'r1',
          actorUserId: 'driver-u',
          reason: 'engine trouble mid-trip',
          meta: expect.objectContaining({
            flaggedForReview: true,
            fromStatus: 'in_progress',
            cancelledBy: 'driver',
          }),
        }),
      );
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled', cancelledBy: 'driver' }),
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(result.status).toBe('cancelled');
    });

    it('a rider cancel of a NOT-yet-started trip is still allowed', async () => {
      const ride = inProgressRide({ riderId: 'owner', status: 'driver_en_route' });
      queryRunner.manager.findOne.mockResolvedValue(ride);
      rides.findOne.mockResolvedValue(ride); // response reload sees the saved state
      drivers.findByUserId.mockResolvedValue(null); // caller is not the driver

      const result = await service.cancel('r1', 'owner', 'rider', { reason: 'changed plans' });

      expect(result.status).toBe('cancelled');
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalledWith(
        AdminAuditLogEntity,
        expect.anything(),
      );
    });
  });

  // SEC-4: booking/matching races — the count() pre-check cannot serialize
  // two concurrent POST /rides (the partial unique index can), and a
  // lock-free rematch could persist a STALE row over a concurrent cancel.
  describe('SEC-4: booking/matching races', () => {
    const bookingDto = {
      vehicleType: 'auto' as const,
      pickup: { address: 'Point A', lat: 12.9, lng: 77.6 },
      dropoff: { address: 'Point B', lat: 13.0, lng: 77.5 },
    };

    it('create() losing the race maps the unique violation to a 409 conflict', async () => {
      rides.count.mockResolvedValue(0); // the pre-check saw zero — then lost
      drivers.findByUserId.mockResolvedValue(null);
      rides.save.mockRejectedValueOnce(
        Object.assign(
          new Error('duplicate key value violates unique constraint "UQ_rides_active_per_rider"'),
          { code: '23505', constraint: 'UQ_rides_active_per_rider' },
        ),
      );

      const err = await service.create('u1', bookingDto).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException); // 409, not 400
      expect((err as Error).message).toContain('You already have an active ride');
      // The loser never reaches the driver search — no second offer storm.
      expect(drivers.findNearby).not.toHaveBeenCalled();
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    it('double-tap: the loser of the race gets the SAME ride back, not a 409', async () => {
      rides.count.mockResolvedValue(0);
      drivers.findByUserId.mockResolvedValue(null);
      rides.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
      // The first tap's ride: same trip, created moments ago.
      rides.findOne.mockResolvedValue(requestedRide({ createdAt: new Date() }));

      const out = await service.create('u1', bookingDto);

      expect(out).toMatchObject({ id: 'r1', status: 'requested' });
      expect(out.match).toEqual({ status: 'no_drivers', candidates: 0 });
      expect(drivers.findNearby).not.toHaveBeenCalled(); // no second offer storm
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();
    });

    it('double-tap arriving AFTER the first ride exists also replays it', async () => {
      rides.count.mockResolvedValue(1);
      drivers.findByUserId.mockResolvedValue(null);
      rides.findOne.mockResolvedValue(requestedRide({ createdAt: new Date() }));

      const out = await service.create('u1', bookingDto);

      expect(out).toMatchObject({ id: 'r1' });
      expect(rides.save).not.toHaveBeenCalled();
      expect(drivers.findNearby).not.toHaveBeenCalled();
    });

    it('a DIFFERENT trip while one is active is still a 409', async () => {
      rides.count.mockResolvedValue(1);
      drivers.findByUserId.mockResolvedValue(null);
      rides.findOne.mockResolvedValue(
        requestedRide({ createdAt: new Date(), dropoff: { address: 'Elsewhere', lat: 14.5, lng: 78.5 } }),
      );

      await expect(service.create('u1', bookingDto)).rejects.toThrow(ConflictException);
      expect(rides.save).not.toHaveBeenCalled();
    });

    it('rematch() re-checks ownership under the row lock', async () => {
      queryRunner.manager.findOne.mockResolvedValue(requestedRide({ riderId: 'someone-else' }));

      await expect(service.rematch('r1', 'u1')).rejects.toThrow(ForbiddenException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(drivers.findNearby).not.toHaveBeenCalled();
    });

    it('rematch() refuses a ride a concurrent cancel already killed', async () => {
      queryRunner.manager.findOne.mockResolvedValue(
        requestedRide({ status: 'cancelled', cancellationReason: 'rider_changed_mind' }),
      );

      await expect(service.rematch('r1', 'u1')).rejects.toThrow('cannot be re-matched');
      // No offer is written for a dead ride and nothing commits.
      expect(drivers.findNearby).not.toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('rematch() writes the offer THROUGH the transaction, not around it', async () => {
      const locked = requestedRide();
      queryRunner.manager.findOne.mockResolvedValue(locked);
      drivers.findNearby.mockResolvedValue([{ driverId: 'drv-9', userId: 'du-9', distance: 80 }]);
      drivers.findById.mockResolvedValue({ id: 'drv-9', userId: 'driver-user' });
      rides.findOne.mockResolvedValue(locked); // relation load + response reload

      const result = await service.rematch('r1', 'u1');

      expect(result.match).toEqual({ status: 'offered', candidates: 1 });
      // The offer lands in the SAME transaction as the "still requested"
      // re-check...
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', driverId: 'drv-9' }),
      );
      // ...and nothing writes the ride outside it (an out-of-txn save could
      // commit a stale row over a concurrent cancel).
      expect(rides.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledWith(
        'driver-user',
        expect.objectContaining({ rideId: 'r1' }),
      );
    });

    it('rematch() cancelling a ride whose offer attempts are used up also commits in-txn', async () => {
      // Default RIDE_MAX_OFFER_ATTEMPTS is 10 (was a hard-coded 3).
      const locked = requestedRide({
        declinedDriverIds: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10'],
      });
      queryRunner.manager.findOne.mockResolvedValue(locked);
      rides.findOne.mockResolvedValue(locked); // response reload after commit
      drivers.findNearby.mockResolvedValue([]);

      const result = await service.rematch('r1', 'u1');

      expect(result.match).toEqual({ status: 'no_drivers', candidates: 0 });
      expect(locked.status).toBe('cancelled');
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled', cancellationReason: 'no_drivers_available' }),
      );
      expect(rides.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  // SEC-9: the review check-write-apply must be atomic (two concurrent
  // submits used to both read rating == null and double-apply the driver
  // rating), and the promo cap must be enforced under the promo row lock
  // (concurrent bookings of one code used to all pass on a stale counter).
  describe('SEC-9: atomic review + locked promo cap', () => {
    const bookingDto = {
      vehicleType: 'auto' as const,
      pickup: { address: 'Point A', lat: 12.9, lng: 77.6 },
      dropoff: { address: 'Point B', lat: 13.0, lng: 77.5 },
    };

    describe('submitReview', () => {
      const completedRide = (overrides: Record<string, unknown> = {}) =>
        requestedRide({ id: 'r9', status: 'completed', driverId: 'drv-1', ...overrides });

      it('writes the review and the driver aggregate in one locked transaction', async () => {
        queryRunner.manager.findOne.mockResolvedValue(completedRide());
        // Post-commit reload for the response view.
        rides.findOne.mockResolvedValue(
          completedRide({ rating: 5, tipAmount: 10, compliments: ['safe'] }),
        );

        const view = await service.submitReview('r9', 'u1', {
          rating: 5,
          compliments: ['safe'],
          tipAmount: 10,
        });

        expect(queryRunner.manager.save).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'r9', rating: 5, tipAmount: 10 }),
        );
        // The aggregate joins the SAME transaction — it moves only if the
        // review commits.
        expect(drivers.applyRating).toHaveBeenCalledWith('drv-1', 5, queryRunner.manager);
        expect(queryRunner.commitTransaction).toHaveBeenCalled();
        expect(view).toMatchObject({ id: 'r9', status: 'completed', rating: 5 });
      });

      it('rejects the concurrent second submit with 409 under the lock', async () => {
        // The lock makes the loser re-read the committed row: rating is set.
        queryRunner.manager.findOne.mockResolvedValue(completedRide({ rating: 4 }));

        await expect(
          service.submitReview('r9', 'u1', { rating: 5 }),
        ).rejects.toThrow(ConflictException);

        expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
        expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
        expect(queryRunner.manager.save).not.toHaveBeenCalled();
        expect(drivers.applyRating).not.toHaveBeenCalled();
        expect(rides.findOne).not.toHaveBeenCalled(); // no response reload on throw
      });

      it('enforces ownership inside the lock', async () => {
        queryRunner.manager.findOne.mockResolvedValue(
          completedRide({ riderId: 'someone-else' }),
        );

        await expect(service.submitReview('r9', 'u1', { rating: 5 })).rejects.toThrow(
          ForbiddenException,
        );
        expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
        expect(queryRunner.manager.save).not.toHaveBeenCalled();
        expect(drivers.applyRating).not.toHaveBeenCalled();
      });
    });

    describe('promo booking', () => {
      it('runs the cap gate and the INSERT in one transaction with the normalised code', async () => {
        rides.count.mockResolvedValue(0);
        drivers.findByUserId.mockResolvedValue(null);
        promos.assertBookable.mockResolvedValue(20);
        rides.findOne.mockResolvedValue(requestedRide()); // post-commit reload

        const out = await service.create('u1', { ...bookingDto, promoCode: ' vazhi20 ' });

        // Trim + upper handed to the gate together with the txn manager...
        expect(promos.assertBookable).toHaveBeenCalledWith(
          queryRunner.manager,
          'VAZHI20',
          'u1',
        );
        // ...and the ride INSERT joins that transaction with the discount the
        // gate approved.
        expect(queryRunner.manager.save).toHaveBeenCalledWith(
          expect.objectContaining({
            promoCode: 'VAZHI20',
            fareBreakdown: expect.objectContaining({ discount: 20 }),
          }),
        );
        expect(queryRunner.commitTransaction).toHaveBeenCalled();
        // Nothing books through the old lock-free advisory path.
        expect(promos.resolveDiscount).not.toHaveBeenCalled();
        expect(rides.save).not.toHaveBeenCalled();
        expect(out.match).toEqual({ status: 'no_drivers', candidates: 0 });
      });

      it('a full cap rejects the booking before any row is written', async () => {
        rides.count.mockResolvedValue(0);
        drivers.findByUserId.mockResolvedValue(null);
        promos.assertBookable.mockRejectedValue(
          new BadRequestException('Promo code "VAZHI20" has reached its redemption limit.'),
        );

        await expect(
          service.create('u1', { ...bookingDto, promoCode: 'VAZHI20' }),
        ).rejects.toThrow('has reached its redemption limit');

        expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
        expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
        expect(queryRunner.manager.save).not.toHaveBeenCalled();
        expect(drivers.findNearby).not.toHaveBeenCalled(); // no driver search storm
      });
    });
  });

  describe('P-1: driver payment confirmation', () => {
    const completedRide = (overrides: Record<string, unknown> = {}) =>
      requestedRide({
        id: 'r5',
        status: 'completed',
        driverId: 'drv-1',
        paymentStatus: 'pending',
        paymentMethod: 'cash',
        ...overrides,
      });

    // Pass-4 (task 2): the confirmation runs under the ride row lock — the
    // locked read is queryRunner.manager.findOne, the write a conditional
    // manager.update, and the audit row joins the same transaction.
    const lockCompletedRide = (ride: Record<string, unknown>) => {
      queryRunner.manager.findOne.mockResolvedValue(ride);
      applyLockUpdates(ride);
      rides.findOne.mockResolvedValue(ride); // post-commit reload for the view
      drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'du1', user: { name: 'Driver' } });
    };

    it('settles a pending ride and records paymentMarkedBy=driver', async () => {
      const ride = completedRide();
      lockCompletedRide(ride);

      await service.markPaymentReceived('r5', 'du1');

      expect(ride.paymentStatus).toBe('paid');
      expect(ride.paymentMarkedBy).toBe('driver');
      // Conditional write on the validated row — never a whole-entity save.
      expect(rides.save).not.toHaveBeenCalled();
      expect(queryRunner.manager.update).toHaveBeenCalledWith(
        RideEntity,
        { id: 'r5', status: 'completed', paymentStatus: 'pending' },
        { paymentStatus: 'paid', paymentMarkedBy: 'driver' },
      );
      // The audit row is written in the SAME transaction (admin console
      // must see every driver self-confirmation).
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        AdminAuditLogEntity,
        expect.objectContaining({
          action: 'payment_driver_confirm',
          targetType: 'ride',
          targetId: 'r5',
          meta: { rideId: 'r5', amount: 240 },
        }),
      );
      // Payment rows stay consistent with the ride (P-1 regression).
      expect(rides.manager.update).toHaveBeenCalledWith(
        PaymentEntity,
        { rideId: 'r5', status: expect.anything() },
        { status: 'paid' },
      );
    });

    it('is idempotent when already paid', async () => {
      const ride = completedRide({ paymentStatus: 'paid', paymentMarkedBy: 'driver' });
      lockCompletedRide(ride);

      await service.markPaymentReceived('r5', 'du1');

      expect(queryRunner.manager.update).not.toHaveBeenCalled(); // no re-transition
      expect(queryRunner.manager.save).not.toHaveBeenCalled(); // no second audit row
      expect(ride.paymentMarkedBy).toBe('driver');
    });

    it('two rapid confirmations produce exactly ONE audit row', async () => {
      const ride = completedRide();
      lockCompletedRide(ride);

      // The pessimistic row lock serialises the two calls in production;
      // sequential calls through the mocked lock model that ordering.
      await service.markPaymentReceived('r5', 'du1');
      await service.markPaymentReceived('r5', 'du1');

      expect(ride.paymentStatus).toBe('paid');
      expect(queryRunner.manager.update).toHaveBeenCalledTimes(1); // one transition
      expect(queryRunner.manager.save).toHaveBeenCalledTimes(1); // one audit row
    });

    it('refuses to settle a disputed payment', async () => {
      const ride = completedRide({ paymentStatus: 'disputed' });
      lockCompletedRide(ride);

      await expect(service.markPaymentReceived('r5', 'du1')).rejects.toThrow(ConflictException);
      expect(ride.paymentStatus).toBe('disputed');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it("refuses a driver who does not own the ride", async () => {
      const ride = completedRide();
      lockCompletedRide(ride);
      drivers.findByUserId.mockResolvedValue({ id: 'drv-other', userId: 'du2', user: { name: 'Other' } });

      await expect(service.markPaymentReceived('r5', 'du2')).rejects.toThrow(ForbiddenException);
      expect(queryRunner.manager.update).not.toHaveBeenCalled();
    });
  });

  // R-5: timers are Redis sorted-set entries claimed with an atomic ZREM.
  describe('R-5: Redis-backed offer/search timers', () => {
    it('a due timer fires exactly once (claimed with ZREM)', async () => {
      const ride = requestedRide({ driverId: 'drv-1' });
      rides.findOne.mockResolvedValue(ride);
      drivers.findNearby.mockResolvedValue([]); // re-match after release finds nobody
      queryRunner.manager.findOne.mockResolvedValue(ride); // locked read (pass-4)
      applyLockUpdates(ride);

      await internals.scheduleOfferTimeout('r1', 15_000);
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).not.toBeNull();

      const due = Date.now() + 16_000;
      const first = await internals.sweepDueTimers(due);
      const second = await internals.sweepDueTimers(due); // entry already claimed

      expect(first).toBe(1);
      expect(second).toBe(0);
      expect(drivers.setAvailability).toHaveBeenCalledTimes(1);
      expect(drivers.setAvailability).toHaveBeenCalledWith('drv-1', true);
      expect(ride.driverId).toBeNull();
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).toBeNull();
    });

    it('two instances sweeping the same timer: exactly one winner', async () => {
      const ride = requestedRide({ driverId: 'drv-1' });
      rides.findOne.mockResolvedValue(ride);
      drivers.findNearby.mockResolvedValue([]);
      queryRunner.manager.findOne.mockResolvedValue(ride); // locked read (pass-4)
      applyLockUpdates(ride);

      await internals.scheduleOfferTimeout('r1', 15_000);
      // Second process: same mocks, SAME FakeRedis = a shared Redis server.
      const other = buildService();

      const due = Date.now() + 16_000;
      const results = await Promise.all([
        internals.sweepDueTimers(due),
        (other as unknown as RidesInternals).sweepDueTimers(due),
      ]);

      expect(results[0] + results[1]).toBe(1); // exactly one fired
      expect(drivers.setAvailability).toHaveBeenCalledTimes(1);
      other.onModuleDestroy();
    });

    it('restart re-arms: a fresh instance keeps the persisted timer working', async () => {
      await internals.scheduleOfferTimeout('r1', 15_000);
      service.onModuleDestroy(); // process dies — local timers would be gone
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).not.toBeNull(); // Redis kept it

      // New process: bootstrap re-arms the still-pending offer with its
      // remaining window (offerExpiresAt 7 s out).
      const s2 = buildService();
      rides.find
        .mockResolvedValueOnce([
          requestedRide({ driverId: 'drv-1', offerExpiresAt: new Date(Date.now() + 7_000) }),
        ])
        .mockResolvedValue([]);
      await s2.onApplicationBootstrap();

      const due = await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1');
      expect(due).not.toBeNull();
      expect(due!).toBeGreaterThan(Date.now()); // pushed into the future

      // ...and once due, the NEW instance fires it.
      const ride = requestedRide({ driverId: 'drv-1' });
      rides.findOne.mockResolvedValue(ride);
      drivers.findNearby.mockResolvedValue([]);
      queryRunner.manager.findOne.mockResolvedValue(ride); // locked read (pass-4)
      applyLockUpdates(ride);
      expect(await (s2 as unknown as RidesInternals).sweepDueTimers(Date.now() + 8_000)).toBe(1);
      expect(drivers.setAvailability).toHaveBeenCalledWith('drv-1', true);

      s2.onModuleDestroy();
    });

    it('cancel removes every timer for the ride', async () => {
      await internals.scheduleOfferTimeout('r1', 15_000);
      await fake.zadd(RIDE_TIMERS_KEY, Date.now() + 90_000, 'search:r1');

      await service.clearPendingTimers('r1');

      expect(await fake.zcard(RIDE_TIMERS_KEY)).toBe(0);
      // A sweep afterwards finds nothing to fire.
      expect(await internals.sweepDueTimers(Date.now() + 120_000)).toBe(0);
    });
  });

  // Pass-4 (task 2): timer handlers re-validate the ride under the row lock,
  // so a timer firing after the state already moved is a strict no-op.
  describe('pass-4 task-2: timer/mutation races', () => {
    it('offer timer firing after the driver already accepted is a no-op', async () => {
      // The driver accepted between arming and firing: by claim time the
      // status is no longer `requested`.
      const accepted = requestedRide({ driverId: 'drv-1', status: 'matched' });
      queryRunner.manager.findOne.mockResolvedValue(accepted);

      await internals.scheduleOfferTimeout('r1', 15_000);
      expect(await internals.sweepDueTimers(Date.now() + 16_000)).toBe(1); // claimed

      expect(queryRunner.manager.update).not.toHaveBeenCalled(); // no stale write
      expect(drivers.setAvailability).not.toHaveBeenCalled(); // driver stays reserved
      expect(gateway.emitRideStatus).not.toHaveBeenCalled();
      expect(accepted.status).toBe('matched'); // ride untouched
    });

    it('search timer on a cancelled ride is a no-op', async () => {
      const cancelled = requestedRide({ status: 'cancelled', cancelledBy: 'rider' });
      queryRunner.manager.findOne.mockResolvedValue(cancelled);
      // The search window came due after the rider had cancelled the ride.
      await fake.zadd(RIDE_TIMERS_KEY, Date.now(), 'search:r1');

      expect(await internals.sweepDueTimers(Date.now() + 1)).toBe(1); // claimed

      expect(queryRunner.manager.update).not.toHaveBeenCalled();
      expect(gateway.emitRideStatus).not.toHaveBeenCalled();
      expect(cancelled.status).toBe('cancelled');
    });

    it('a conditional write that matched no row releases nothing', async () => {
      const ride = requestedRide({ driverId: 'drv-1' });
      queryRunner.manager.findOne.mockResolvedValue(ride);
      // Belt-and-braces: even under the lock the write is conditional on the
      // exact status+driver; affected=0 means "someone beat us to it".
      queryRunner.manager.update.mockResolvedValueOnce({ affected: 0 });

      await internals.scheduleOfferTimeout('r1', 15_000);
      expect(await internals.sweepDueTimers(Date.now() + 16_000)).toBe(1); // claimed

      expect(drivers.setAvailability).not.toHaveBeenCalled(); // nothing committed
      expect(gateway.emitRideStatus).not.toHaveBeenCalled();
    });
  });

  // Pass-4 (task 6): hard trip limits (block absurd input) + soft fraud
  // flags (never block — one `ride_flag` audit row per target+reason).
  describe('pass-4 task-6: trip fraud limits', () => {
    const booking = (overrides: Record<string, unknown> = {}) => ({
      vehicleType: 'auto' as const,
      pickup: { address: 'Point A', lat: 12.9, lng: 77.6 },
      dropoff: { address: 'Point B', lat: 13.0, lng: 77.5 },
      ...overrides,
    });

    beforeEach(() => {
      drivers.findByUserId.mockResolvedValue(null);
    });

    describe('hard limits on create()', () => {
      it('refuses pickup == dropoff (< 100 m apart)', async () => {
        await expect(
          service.create('u1', booking({ dropoff: { address: 'Here', lat: 12.9, lng: 77.6 } })),
        ).rejects.toThrow('must be at least 100 m apart');
        expect(rides.save).not.toHaveBeenCalled();
      });

      it('refuses a routed distance over MAX_TRIP_KM with a clear message', async () => {
        service = buildService({}, 200); // routed 200 km > default 150

        await expect(service.create('u1', booking())).rejects.toThrow('exceeds the 150 km limit');
        expect(rides.save).not.toHaveBeenCalled();
      });

      it('refuses a pickup outside SERVICE_AREA_BBOX', async () => {
        service = buildService({ SERVICE_AREA_BBOX: '12.0,76.5,13.0,77.4' }); // pickup lng too far east

        await expect(service.create('u1', booking())).rejects.toThrow(
          'Pickup is outside the service area',
        );
      });

      it('refuses a dropoff outside SERVICE_AREA_BBOX', async () => {
        service = buildService({ SERVICE_AREA_BBOX: '12.8,77.4,12.95,78.0' }); // dropoff lat too far north

        await expect(service.create('u1', booking())).rejects.toThrow(
          'Dropoff is outside the service area',
        );
      });
    });

    describe('soft flag: pickup_far (verifyPickupOtp)', () => {
      const armTripStart = () => {
        const ride = requestedRide({
          status: 'driver_en_route',
          driverId: 'drv-1',
          pickupOtp: '1234',
        });
        queryRunner.manager.findOne.mockResolvedValue(ride);
        rides.findOne.mockResolvedValue(ride);
        drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'du1' });
        return ride;
      };

      it('flags a driver > 1 km from pickup when the trip starts', async () => {
        armTripStart();
        drivers.findById.mockResolvedValue({
          id: 'drv-1',
          userId: 'du1',
          location: { coordinates: [77.6, 12.911] }, // ~1.2 km north of pickup
          locationUpdatedAt: new Date(),
        });

        await service.verifyPickupOtp('r1', 'du1', { otp: '1234' });

        expect(rides.manager.save).toHaveBeenCalledWith(
          AdminAuditLogEntity,
          expect.objectContaining({
            action: 'ride_flag',
            targetType: 'ride',
            targetId: 'r1',
            reason: 'pickup_far',
          }),
        );
      });

      it('does NOT flag a driver standing at the pickup', async () => {
        armTripStart();
        drivers.findById.mockResolvedValue({
          id: 'drv-1',
          userId: 'du1',
          location: { coordinates: [77.6, 12.9] },
          locationUpdatedAt: new Date(),
        });

        await service.verifyPickupOtp('r1', 'du1', { otp: '1234' });

        expect(rides.manager.save).not.toHaveBeenCalled();
      });

      it('does NOT flag on a stale location (> 5 min old)', async () => {
        armTripStart();
        drivers.findById.mockResolvedValue({
          id: 'drv-1',
          userId: 'du1',
          location: { coordinates: [77.6, 12.911] },
          locationUpdatedAt: new Date(Date.now() - 6 * 60_000),
        });

        await service.verifyPickupOtp('r1', 'du1', { otp: '1234' });

        expect(rides.manager.save).not.toHaveBeenCalled();
      });

      it('writes the flag only once per ride+reason (dedup)', async () => {
        armTripStart();
        drivers.findById.mockResolvedValue({
          id: 'drv-1',
          userId: 'du1',
          location: { coordinates: [77.6, 12.911] },
          locationUpdatedAt: new Date(),
        });
        rides.manager.findOne.mockResolvedValue({ id: 'audit-1' }); // flag already exists

        await service.verifyPickupOtp('r1', 'du1', { otp: '1234' });

        expect(rides.manager.save).not.toHaveBeenCalled();
      });
    });

    describe('soft flags on complete()', () => {
      const armComplete = (driverAt: [number, number]) => {
        const ride = requestedRide({
          status: 'in_progress',
          driverId: 'drv-1',
          distanceKm: '5',
        });
        queryRunner.manager.findOne.mockResolvedValue(ride);
        rides.findOne.mockResolvedValue(ride);
        drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'du1' });
        drivers.findById.mockResolvedValue({
          id: 'drv-1',
          userId: 'du1',
          vehicleType: 'auto',
          location: { coordinates: driverAt }, // [lng, lat]
          locationUpdatedAt: new Date(),
        });
        return ride;
      };

      it('flags dropoff_far when the driver is > 1 km from the dropoff', async () => {
        armComplete([77.6, 12.9]); // ~15 km from dropoff (13.0, 77.5)

        await service.complete('r1', 'du1', {});

        expect(rides.manager.save).toHaveBeenCalledWith(
          AdminAuditLogEntity,
          expect.objectContaining({
            action: 'ride_flag',
            targetType: 'ride',
            targetId: 'r1',
            reason: 'dropoff_far',
          }),
        );
        // No distance claim given → no inflated flag.
        expect(rides.manager.save).not.toHaveBeenCalledWith(
          AdminAuditLogEntity,
          expect.objectContaining({ reason: 'distance_inflated' }),
        );
      });

      it('flags distance_inflated when the claim is > 1.15x the routed distance', async () => {
        armComplete([77.5, 13.0]); // at the dropoff — no dropoff_far

        await service.complete('r1', 'du1', { actualDistanceKm: 10 });

        expect(rides.manager.save).toHaveBeenCalledWith(
          AdminAuditLogEntity,
          expect.objectContaining({
            action: 'ride_flag',
            targetType: 'ride',
            targetId: 'r1',
            reason: 'distance_inflated',
          }),
        );
        expect(rides.manager.save).not.toHaveBeenCalledWith(
          AdminAuditLogEntity,
          expect.objectContaining({ reason: 'dropoff_far' }),
        );
      });

      it('does NOT flag a normal completion (at dropoff, honest distance)', async () => {
        armComplete([77.5, 13.0]);

        await service.complete('r1', 'du1', { actualDistanceKm: 5.2 });

        expect(rides.manager.save).not.toHaveBeenCalled();
      });
    });

    describe('Idempotency-Key support (Task 11)', () => {
      it('returns cached response when the same idempotency key is presented within 60s', async () => {
        const cachedPayload = { id: 'ride-cached-1', status: 'requested', fareBreakdown: { total: 100 } };
        // Seed Redis with the idempotency key
        await (service as any).redis.set(
          'idempotency:rides:rider-1:key-123',
          JSON.stringify(cachedPayload),
          'EX',
          60,
        );

        const result = await service.create(
          'rider-1',
          {
            vehicleType: 'auto',
            pickup: { address: 'A', lat: 11.66, lng: 78.15 },
            dropoff: { address: 'B', lat: 11.67, lng: 78.16 },
          },
          'key-123',
        );

        expect(result).toEqual(cachedPayload);
        // Did not create a new ride
        expect(rides.create).not.toHaveBeenCalled();
      });
    });
  });

  // A rider who booked while NOBODY was online keeps waiting; when a driver
  // comes online later, the periodic matchWaitingRides() offers the ride to them.
  describe('rides waiting for a driver are matched when a driver comes online', () => {
    const hit = (driverId: string, distanceMeters: number) => ({
      driverId,
      userId: `u-${driverId}`,
      distanceMeters,
    });

    it('does nothing (no lock, no offer) while nobody is online, then offers the ride once a driver is', async () => {
      const ride = requestedRide();
      rides.find.mockResolvedValue([ride]);
      rides.findOne.mockResolvedValue(ride);
      queryRunner.manager.findOne.mockResolvedValue(ride); // the row, read under the lock
      await fake.zadd(RIDE_TIMERS_KEY, Date.now() + 90_000, 'search:r1'); // the search window

      // Tick 1: no driver online.
      drivers.findNearby.mockResolvedValue([]);
      expect(await service.matchWaitingRides()).toBe(0);
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();

      // Tick 2: a driver came online near the pickup.
      drivers.findNearby.mockResolvedValue([hit('near', 300)]);
      drivers.findById.mockResolvedValue({ id: 'near', userId: 'u-near' });
      expect(await service.matchWaitingRides()).toBe(1);

      expect(ride.driverId).toBe('near');
      expect(drivers.claimAvailability).toHaveBeenCalledWith('near', queryRunner.manager);
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledTimes(1);
      expect(gateway.emitRideRequestToDriver).toHaveBeenCalledWith(
        'u-near',
        expect.objectContaining({ rideId: 'r1' }),
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      // The offer replaces the search window: the offer timer is armed.
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).toBeNull();
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'offer:r1')).not.toBeNull();
    });

    it('does not restart the search window while it keeps looking', async () => {
      const ride = requestedRide();
      rides.find.mockResolvedValue([ride]);
      queryRunner.manager.findOne.mockResolvedValue(ride);
      await fake.zadd(RIDE_TIMERS_KEY, Date.now() + 40_000, 'search:r1');
      const before = await fake.zscore(RIDE_TIMERS_KEY, 'search:r1');
      // Someone is listed nearby, but another booking claims them first.
      drivers.findNearby.mockResolvedValue([hit('near', 300)]);
      drivers.claimAvailability.mockResolvedValue(false);

      expect(await service.matchWaitingRides()).toBe(0);

      expect(ride.driverId).toBeNull();
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();
      // A retry must never push the deadline back, or the ride would never time out.
      expect(await fake.zscore(RIDE_TIMERS_KEY, 'search:r1')).toEqual(before);
    });

    it('skips drivers who already declined this ride and the rider\u2019s own driver profile', async () => {
      const ride = requestedRide({ declinedDriverIds: ['declined'] });
      rides.find.mockResolvedValue([ride]);
      drivers.findNearby.mockResolvedValue([hit('declined', 100), { driverId: 'self', userId: 'u1', distanceMeters: 50 }]);

      expect(await service.matchWaitingRides()).toBe(0);

      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();
    });

    it('leaves a ride alone that was cancelled or taken by the time the lock is held', async () => {
      rides.find.mockResolvedValue([requestedRide()]);
      drivers.findNearby.mockResolvedValue([hit('near', 300)]);
      queryRunner.manager.findOne.mockResolvedValue(requestedRide({ status: 'cancelled' }));

      expect(await service.matchWaitingRides()).toBe(0);

      expect(drivers.claimAvailability).not.toHaveBeenCalled();
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();

      queryRunner.manager.findOne.mockResolvedValue(requestedRide({ driverId: 'someone-else' }));
      expect(await service.matchWaitingRides()).toBe(0);
      expect(drivers.claimAvailability).not.toHaveBeenCalled();
    });

    it('never throws when the lookup or one ride fails (Redis / database down)', async () => {
      rides.find.mockRejectedValueOnce(new Error('db down'));
      await expect(service.matchWaitingRides()).resolves.toBe(0);

      rides.find.mockResolvedValue([requestedRide()]);
      drivers.findNearby.mockRejectedValue(new Error('redis down'));
      await expect(service.matchWaitingRides()).resolves.toBe(0);
    });
  });

  // The rider's "trip duration" is startedAt -> completedAt, so both views
  // must carry startedAt (null when the trip never started).
  describe('ride views expose startedAt', () => {
    it('includes startedAt in the rider and driver views, null when never started', () => {
      const startedAt = new Date('2026-10-29T10:00:00.000Z');
      const completedAt = new Date('2026-10-29T10:18:00.000Z');
      const ride = requestedRide({ status: 'completed', startedAt, completedAt }) as unknown as RideEntity;

      expect(service.toRiderView(ride).startedAt).toEqual(startedAt);
      expect(service.toDriverView(ride).startedAt).toEqual(startedAt);
      expect(service.toRiderView(ride).completedAt).toEqual(completedAt);

      const neverStarted = requestedRide() as unknown as RideEntity;
      expect(service.toRiderView(neverStarted).startedAt).toBeNull();
      expect(service.toDriverView(neverStarted).startedAt).toBeNull();
    });
  });

  it('skips an overlapping timer sweep while Redis is still resolving the prior sweep', async () => {
    let release!: (members: string[]) => void;
    const pending = new Promise<string[]>((resolve) => {
      release = resolve;
    });
    fake.zrangebyscore = jest.fn().mockReturnValue(pending);

    const first = internals.sweepDueTimers();
    await Promise.resolve();
    await expect(internals.sweepDueTimers()).resolves.toBe(0);
    expect(fake.zrangebyscore).toHaveBeenCalledTimes(1);

    release([]);
    await expect(first).resolves.toBe(0);
  });
});
