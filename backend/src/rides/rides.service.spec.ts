import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { RidesService } from './rides.service';
import { RideEntity } from './entities/ride.entity';
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
 */
type RidesInternals = {
  matchNearestDriver(ride: RideEntity): Promise<{ status: 'offered' | 'no_drivers'; candidates: number }>;
  scheduleOfferTimeout(rideId: string, driverId: string, timeoutMs: number): void;
  offerTimeouts: Map<string, NodeJS.Timeout>;
  searchTimeouts: Map<string, NodeJS.Timeout>;
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
    manager: { connection: { createQueryRunner: jest.Mock } };
  };
  let drivers: Record<string, jest.Mock>;
  let gateway: Record<string, jest.Mock>;
  let queryRunner: QueryRunnerStub;

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

    service = new RidesService(
      rides as unknown as Repository<RideEntity>,
      drivers as unknown as DriversService,
      { removeDriver: jest.fn().mockResolvedValue(undefined), upsertDriverLocation: jest.fn().mockResolvedValue(undefined) } as unknown as GeoService,
      gateway as unknown as RidesGateway,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      { discountFor: jest.fn().mockReturnValue(0), resolveDiscount: jest.fn().mockResolvedValue(0) } as unknown as PromosService,
      // R-7: routed distance — tests use a fixed estimate (no HTTP).
      { routedKm: jest.fn().mockResolvedValue(5) } as unknown as RouteDistanceService,
    );
    internals = service as unknown as RidesInternals;
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('R-1: search timeout for no-drivers bookings', () => {
    it('arms a search window and auto-cancels with no_drivers_available', async () => {
      jest.useFakeTimers();
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([]); // nobody nearby at any strategy
      rides.findOne.mockResolvedValue(ride);

      const match = await internals.matchNearestDriver(ride as unknown as RideEntity);

      expect(match).toEqual({ status: 'no_drivers', candidates: 0 });
      expect(internals.searchTimeouts.has('r1')).toBe(true);

      await jest.advanceTimersByTimeAsync(90_000);

      expect(ride.status).toBe('cancelled');
      expect(ride.cancellationReason).toBe('no_drivers_available');
      expect(ride.cancelledBy).toBe('system');
      expect(gateway.emitRideStatus).toHaveBeenCalledWith(
        'r1',
        'u1',
        null,
        expect.objectContaining({ status: 'cancelled' }),
      );
      expect(internals.searchTimeouts.has('r1')).toBe(false);
    });

    it('does not cancel the search once a driver has been offered', async () => {
      jest.useFakeTimers();
      const ride = requestedRide();
      drivers.findNearby.mockResolvedValue([]);
      rides.findOne.mockResolvedValue(ride);

      await internals.matchNearestDriver(ride as unknown as RideEntity);
      // A driver appeared before the window elapsed (offer made elsewhere).
      ride.driverId = 'drv-1';

      await jest.advanceTimersByTimeAsync(90_000);

      expect(ride.status).toBe('requested');
      expect(gateway.emitRideStatus).not.toHaveBeenCalled();
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
      jest.useFakeTimers();
      internals.scheduleOfferTimeout('r1', 'drv-1', 15_000);
      expect(internals.offerTimeouts.has('r1')).toBe(true);

      queryRunner.manager.findOne.mockResolvedValue(requestedRide({ riderId: 'owner' }));
      drivers.findByUserId.mockRejectedValue(new Error('not a driver'));

      await expect(
        service.cancel('r1', 'intruder', 'rider', { reason: 'not mine to cancel' }),
      ).rejects.toThrow(ForbiddenException);

      // Regression guard: the timer must survive a rejected (foreign) cancel,
      // otherwise the offered driver stays isAvailable=false forever.
      expect(internals.offerTimeouts.has('r1')).toBe(true);
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('the owning rider cancels inside a locked transaction and timers die', async () => {
      jest.useFakeTimers();
      internals.scheduleOfferTimeout('r1', 'drv-1', 15_000);
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
      expect(internals.offerTimeouts.has('r1')).toBe(false);
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
});
