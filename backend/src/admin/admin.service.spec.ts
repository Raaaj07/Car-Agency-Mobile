import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { PaymentEntity } from '../payments/entities/payment.entity';
import { GeoService } from '../drivers/geo.service';
import { StorageService } from '../drivers/storage.service';
import { RidesGateway } from '../rides/gateway/rides.gateway';
import { RidesService } from '../rides/rides.service';

/**
 * A-2 (status machine) and A-3 (no orphaned rides on suspend):
 *  - suspend only from `approved`
 *  - reinstate only from `suspended` AND only when `approvedAt` is set
 *  - suspend with an in-flight ride answers 409 + rideId unless force=true
 */
describe('AdminService status machine (A-2, A-3)', () => {
  let service: AdminService;
  let drivers: Record<string, jest.Mock>;
  let rides: Record<string, jest.Mock>;
  let geo: Record<string, jest.Mock>;
  let gateway: Record<string, jest.Mock>;
  let audit: Record<string, jest.Mock>;
  let ridesSvc: Record<string, jest.Mock>;
  let payments: Record<string, jest.Mock>;

  const SUSPEND_REASON = 'Repeated rider cancellations reported';
  const suspendOpts = { reason: SUSPEND_REASON };

  const driverFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'drv-1',
    userId: 'drv-user-1',
    status: 'approved',
    approvedAt: new Date('2026-01-01'),
    vehicleType: 'auto',
    isOnline: true,
    isAvailable: true,
    ...overrides,
  });

  const activeRideFixture = () => ({
    id: 'ride-9',
    status: 'matched',
    driverId: 'drv-1',
    riderId: 'rider-1',
    cancellationReason: null,
    cancelledBy: null,
  });

  beforeEach(() => {
    drivers = {
      findOne: jest.fn(),
      save: jest.fn(async (d) => d),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    rides = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    geo = { removeDriver: jest.fn().mockResolvedValue(undefined) };
    gateway = { emitDriverStatus: jest.fn(), emitRideStatus: jest.fn() };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
      historyForDriver: jest.fn().mockResolvedValue([]),
      list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    };
    ridesSvc = { clearPendingTimers: jest.fn() };
    payments = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    service = new AdminService(
      {} as unknown as Repository<UserEntity>,
      drivers as unknown as Repository<DriverEntity>,
      rides as unknown as Repository<RideEntity>,
      payments as unknown as Repository<PaymentEntity>,
      geo as unknown as GeoService,
      {} as unknown as StorageService,
      gateway as unknown as RidesGateway,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      audit as unknown as AdminAuditService,
      ridesSvc as unknown as RidesService,
    );
  });

  describe('suspend (A-2)', () => {
    it('refuses to suspend from pending', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'pending', approvedAt: null }));

      await expect(service.suspend('drv-1', 'admin-1', suspendOpts)).rejects.toThrow(ConflictException);
      expect(drivers.save).not.toHaveBeenCalled();
      expect(rides.findOne).not.toHaveBeenCalled();
    });

    it('refuses to suspend from rejected', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'rejected' }));

      await expect(service.suspend('drv-1', 'admin-1', suspendOpts)).rejects.toThrow(ConflictException);
      expect(drivers.save).not.toHaveBeenCalled();
    });

    it('suspends an approved driver', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());

      const result = await service.suspend('drv-1', 'admin-1', suspendOpts);

      expect(drivers.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'drv-1', status: 'suspended' }),
      );
      expect(gateway.emitDriverStatus).toHaveBeenCalledWith('drv-user-1', { status: 'suspended' });
      expect(result.status).toBe('suspended');
    });

    it('is idempotent when already suspended', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'suspended' }));

      await expect(service.suspend('drv-1', 'admin-1', suspendOpts)).resolves.toMatchObject({
        status: 'suspended',
      });
      expect(drivers.save).not.toHaveBeenCalled();
    });

    it('404s for an unknown driver', async () => {
      drivers.findOne.mockResolvedValue(null);

      await expect(service.suspend('nope', 'admin-1', suspendOpts)).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspend with an active ride (A-3)', () => {
    it('answers 409 carrying the ride id unless force is set', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());
      rides.findOne.mockResolvedValue(activeRideFixture());

      const err = await service.suspend('drv-1', 'admin-1', suspendOpts).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ rideId: 'ride-9' });
      // Nothing changed: driver still approved, ride untouched.
      expect(drivers.save).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('force=true cancels the ride first (cancelledBy=admin), then suspends', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());
      rides.findOne.mockResolvedValue(activeRideFixture());

      await service.suspend('drv-1', 'admin-1', { reason: SUSPEND_REASON, force: true });

      // Ride cancelled with the admin as actor and the driver freed.
      expect(rides.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ride-9' }),
        expect.objectContaining({ status: 'cancelled', cancelledBy: 'admin' }),
      );
      expect(drivers.update).toHaveBeenCalledWith(
        { id: 'drv-1' },
        { isAvailable: true },
      );
      expect(gateway.emitRideStatus).toHaveBeenCalledWith(
        'ride-9',
        'rider-1',
        'drv-user-1',
        expect.objectContaining({ status: 'cancelled', driverId: null }),
      );
      // Driver suspended afterwards.
      expect(drivers.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'drv-1', status: 'suspended' }),
      );
      expect(geo.removeDriver).toHaveBeenCalled();
    });
  });

  describe('reinstate (A-2)', () => {
    it('refuses to reinstate from pending (backdoor approval)', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'pending' }));

      await expect(service.reinstate('drv-1', 'admin-1')).rejects.toThrow(ConflictException);
      expect(drivers.save).not.toHaveBeenCalled();
    });

    it('refuses to reinstate a suspended driver who was never approved', async () => {
      drivers.findOne.mockResolvedValue(
        driverFixture({ status: 'suspended', approvedAt: null }),
      );

      await expect(service.reinstate('drv-1', 'admin-1')).rejects.toThrow(ConflictException);
      expect(drivers.save).not.toHaveBeenCalled();
    });

    it('reinstates a previously approved suspended driver', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'suspended' }));

      await service.reinstate('drv-1', 'admin-1');

      expect(drivers.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'drv-1', status: 'approved', rejectionReason: null }),
      );
      expect(gateway.emitDriverStatus).toHaveBeenCalledWith('drv-user-1', { status: 'approved' });
    });

    it('is idempotent when already approved', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'approved' }));

      await expect(service.reinstate('drv-1', 'admin-1')).resolves.toMatchObject({
        status: 'approved',
      });
      expect(drivers.save).not.toHaveBeenCalled();
    });
  });

  describe('approve (A-2 support)', () => {
    it('stamps approvedAt so a later suspend→reinstate is legal', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'pending', approvedAt: null }));

      await service.approve('drv-1', 'admin-1');

      expect(drivers.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          approvedAt: expect.any(Date) as unknown as Date,
          reviewedAt: expect.any(Date) as unknown as Date,
        }),
      );
    });
  });

  describe('Phase 2: audited actions', () => {
    it('requires a 5–300 char reason before touching the driver', async () => {
      await expect(service.suspend('drv-1', 'admin-1', { reason: 'no' })).rejects.toThrow(BadRequestException);
      expect(drivers.findOne).not.toHaveBeenCalled();
    });

    it('writes an audit row with the reason on suspend', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());

      await service.suspend('drv-1', 'admin-1', suspendOpts);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'suspend',
          targetType: 'driver',
          targetId: 'drv-1',
          reason: SUSPEND_REASON,
          meta: expect.objectContaining({ previousStatus: 'approved' }),
        }),
      );
    });

    it('writes an audit row on approve (actor + previous status)', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'pending', approvedAt: null }));

      await service.approve('drv-1', 'admin-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approve',
          targetType: 'driver',
          targetId: 'drv-1',
          meta: expect.objectContaining({ previousStatus: 'pending' }),
        }),
      );
    });

    it('writes an audit row with the reason on reject', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'pending' }));

      await service.reject('drv-1', 'admin-1', 'Licence image is unreadable');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reject', targetType: 'driver', reason: 'Licence image is unreadable' }),
      );
    });

    it('reinstate audit row carries the optional reason', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'suspended' }));

      await service.reinstate('drv-1', 'admin-1', { reason: 'Warning acknowledged' });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reinstate', targetType: 'driver', reason: 'Warning acknowledged' }),
      );
    });
  });

  describe('admin ride cancel', () => {
    it('cancels a non-terminal ride, clears timers and audits it', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());
      rides.findOne.mockResolvedValue(activeRideFixture());

      const result = await service.adminCancelRide('ride-9', 'admin-1', 'Rider asked support to cancel');

      expect(rides.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ride-9' }),
        expect.objectContaining({ status: 'cancelled', cancelledBy: 'admin' }),
      );
      expect(ridesSvc.clearPendingTimers).toHaveBeenCalledWith('ride-9');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ride_cancel', targetType: 'ride', targetId: 'ride-9' }),
      );
      expect(result).toMatchObject({ status: 'cancelled', cancelledBy: 'admin' });
    });

    it('refuses to cancel a finished ride', async () => {
      rides.findOne.mockResolvedValue({ ...activeRideFixture(), status: 'completed' });

      await expect(service.adminCancelRide('ride-9', 'admin-1', 'Too late to cancel now')).rejects.toThrow(
        ConflictException,
      );
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('payment resolution (P-1 admin path)', () => {
    const completedRide = (overrides: Record<string, unknown> = {}) => ({
      ...activeRideFixture(),
      status: 'completed',
      paymentStatus: 'disputed',
      paymentMarkedBy: null,
      ...overrides,
    });

    it('marking paid sets paymentMarkedBy=admin, flips rows, audits', async () => {
      rides.findOne.mockResolvedValue(completedRide());
      rides.update.mockResolvedValue({ affected: 1 });

      const result = await service.resolvePayment('ride-9', 'admin-1', 'paid', 'UPI settlement screenshot verified');

      expect(rides.update).toHaveBeenCalledWith(
        { id: 'ride-9' },
        { paymentStatus: 'paid', paymentMarkedBy: 'admin' },
      );
      expect(payments.update).toHaveBeenCalledWith({ rideId: 'ride-9' }, { status: 'paid' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_resolve',
          targetType: 'ride',
          targetId: 'ride-9',
          reason: 'UPI settlement screenshot verified',
        }),
      );
      expect(result).toMatchObject({ paymentStatus: 'paid', paymentMarkedBy: 'admin' });
    });

    it('marking disputed only touches rows that are not settled yet', async () => {
      rides.findOne.mockResolvedValue(completedRide({ paymentStatus: 'paid' }));
      rides.update.mockResolvedValue({ affected: 1 });

      await service.resolvePayment('ride-9', 'admin-1', 'disputed', 'Rider reports non-payment to driver');

      expect(payments.update).toHaveBeenCalledWith(
        { rideId: 'ride-9', status: expect.anything() },
        { status: 'disputed' },
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment_resolve', reason: 'Rider reports non-payment to driver' }),
      );
    });

    it('refuses to resolve payment for an unfinished ride', async () => {
      rides.findOne.mockResolvedValue(completedRide({ status: 'in_progress', paymentStatus: 'pending' }));

      await expect(service.resolvePayment('ride-9', 'admin-1', 'paid', 'Trying to settle early')).rejects.toThrow(
        ConflictException,
      );
      expect(rides.update).not.toHaveBeenCalled();
    });
  });
});
