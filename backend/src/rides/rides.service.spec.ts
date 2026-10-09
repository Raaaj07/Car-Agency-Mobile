import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { FakeRedis } from '../test/fake-redis';
import { RIDE_TIMERS_KEY, RidesService } from './rides.service';
import { RideEntity } from './entities/ride.entity';
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';
import { DriversService } from '../drivers/drivers.service';
import { GeoService } from '../drivers/geo.service';
import { RidesGateway } from './gateway/rides.gateway';
import { PromosService } from '../promos/promos.service';
import { RouteDistanceService } from './route-distance.service';

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
  manager: { findOne: jest.Mock; save: jest.Mock };
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
    manager: { connection: { createQueryRunner: jest.Mock }; update: jest.Mock };
  };
  let drivers: Record<string, jest.Mock>;
  let gateway: Record<string, jest.Mock>;
  let queryRunner: QueryRunnerStub;
  // Shared "Redis server" — extra service instances in a test join the same
  // FakeRedis to model multiple backend processes (R-5).
  let fake: FakeRedis;

  const buildService = (): RidesService =>
    new RidesService(
      rides as unknown as Repository<RideEntity>,
      drivers as unknown as DriversService,
      { removeDriver: jest.fn().mockResolvedValue(undefined), upsertDriverLocation: jest.fn().mockResolvedValue(undefined) } as unknown as GeoService,
      gateway as unknown as RidesGateway,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {
        discountFor: jest.fn().mockResolvedValue(0),
        resolveDiscount: jest.fn().mockResolvedValue(0),
        recordRedemption: jest.fn().mockResolvedValue(undefined),
      } as unknown as PromosService,
      // R-7: routed distance — tests use a fixed estimate (no HTTP).
      { routedKm: jest.fn().mockResolvedValue(5) } as unknown as RouteDistanceService,
      fake as unknown as Redis,
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
      },
    };
    drivers = {
      findByUserId: jest.fn(),
      findById: jest.fn().mockRejectedValue(new Error('driver not loaded')),
      findNearby: jest.fn().mockResolvedValue([]),
      setAvailability: jest.fn().mockResolvedValue(undefined),
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
      },
    };
    (rides.manager.connection.createQueryRunner as jest.Mock).mockReturnValue(queryRunner);

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

      await internals.sweepDueTimers(Date.now() + 90_001);

      expect(ride.status).toBe('requested');
      expect(rides.update).not.toHaveBeenCalled();
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
        { id: 'r2', status: 'requested' },
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

    it('create() losing the race maps the unique violation to the friendly 400', async () => {
      rides.count.mockResolvedValue(0); // the pre-check saw zero — then lost
      drivers.findByUserId.mockResolvedValue(null);
      rides.save.mockRejectedValueOnce(
        Object.assign(
          new Error('duplicate key value violates unique constraint "UQ_rides_active_per_rider"'),
          { code: '23505', constraint: 'UQ_rides_active_per_rider' },
        ),
      );

      await expect(service.create('u1', bookingDto)).rejects.toThrow(
        'You already have an active ride',
      );
      // The loser never reaches the driver search — no second offer storm.
      expect(drivers.findNearby).not.toHaveBeenCalled();
      expect(gateway.emitRideRequestToDriver).not.toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
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

    it('rematch() cancelling a thrice-declined ride also commits in-txn', async () => {
      const locked = requestedRide({ declinedDriverIds: ['d1', 'd2', 'd3'] });
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

    it('settles a pending ride and records paymentMarkedBy=driver', async () => {
      const ride = completedRide();
      rides.findOne.mockResolvedValue(ride);
      drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'du1', user: { name: 'Driver' } });

      await service.markPaymentReceived('r5', 'du1');

      expect(ride.paymentStatus).toBe('paid');
      expect(ride.paymentMarkedBy).toBe('driver');
      expect(rides.save).toHaveBeenCalledWith(ride);
    });

    it('is idempotent when already paid', async () => {
      const ride = completedRide({ paymentStatus: 'paid', paymentMarkedBy: 'driver' });
      rides.findOne.mockResolvedValue(ride);
      drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'du1', user: { name: 'Driver' } });

      await service.markPaymentReceived('r5', 'du1');

      expect(rides.save).not.toHaveBeenCalled();
      expect(ride.paymentMarkedBy).toBe('driver');
    });

    it('refuses to settle a disputed payment', async () => {
      const ride = completedRide({ paymentStatus: 'disputed' });
      rides.findOne.mockResolvedValue(ride);
      drivers.findByUserId.mockResolvedValue({ id: 'drv-1', userId: 'du1', user: { name: 'Driver' } });

      await expect(service.markPaymentReceived('r5', 'du1')).rejects.toThrow(ConflictException);
      expect(ride.paymentStatus).toBe('disputed');
    });

    it("refuses a driver who does not own the ride", async () => {
      rides.findOne.mockResolvedValue(completedRide());
      drivers.findByUserId.mockResolvedValue({ id: 'drv-other', userId: 'du2', user: { name: 'Other' } });

      await expect(service.markPaymentReceived('r5', 'du2')).rejects.toThrow(ForbiddenException);
    });
  });

  // R-5: timers are Redis sorted-set entries claimed with an atomic ZREM.
  describe('R-5: Redis-backed offer/search timers', () => {
    it('a due timer fires exactly once (claimed with ZREM)', async () => {
      const ride = requestedRide({ driverId: 'drv-1' });
      rides.findOne.mockResolvedValue(ride);
      drivers.findNearby.mockResolvedValue([]); // re-match after release finds nobody

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
});
