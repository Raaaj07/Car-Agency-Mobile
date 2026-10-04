import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AdminService } from './admin.service';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { GeoService } from '../drivers/geo.service';
import { StorageService } from '../drivers/storage.service';
import { RidesGateway } from '../rides/gateway/rides.gateway';

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

    service = new AdminService(
      {} as unknown as Repository<UserEntity>,
      drivers as unknown as Repository<DriverEntity>,
      rides as unknown as Repository<RideEntity>,
      geo as unknown as GeoService,
      {} as unknown as StorageService,
      gateway as unknown as RidesGateway,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
  });

  describe('suspend (A-2)', () => {
    it('refuses to suspend from pending', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'pending', approvedAt: null }));

      await expect(service.suspend('drv-1', 'admin-1')).rejects.toThrow(ConflictException);
      expect(drivers.save).not.toHaveBeenCalled();
      expect(rides.findOne).not.toHaveBeenCalled();
    });

    it('refuses to suspend from rejected', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'rejected' }));

      await expect(service.suspend('drv-1', 'admin-1')).rejects.toThrow(ConflictException);
      expect(drivers.save).not.toHaveBeenCalled();
    });

    it('suspends an approved driver', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());

      const result = await service.suspend('drv-1', 'admin-1');

      expect(drivers.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'drv-1', status: 'suspended' }),
      );
      expect(gateway.emitDriverStatus).toHaveBeenCalledWith('drv-user-1', { status: 'suspended' });
      expect(result.status).toBe('suspended');
    });

    it('is idempotent when already suspended', async () => {
      drivers.findOne.mockResolvedValue(driverFixture({ status: 'suspended' }));

      await expect(service.suspend('drv-1', 'admin-1')).resolves.toMatchObject({
        status: 'suspended',
      });
      expect(drivers.save).not.toHaveBeenCalled();
    });

    it('404s for an unknown driver', async () => {
      drivers.findOne.mockResolvedValue(null);

      await expect(service.suspend('nope', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspend with an active ride (A-3)', () => {
    it('answers 409 carrying the ride id unless force is set', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());
      rides.findOne.mockResolvedValue(activeRideFixture());

      const err = await service.suspend('drv-1', 'admin-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ rideId: 'ride-9' });
      // Nothing changed: driver still approved, ride untouched.
      expect(drivers.save).not.toHaveBeenCalled();
      expect(rides.update).not.toHaveBeenCalled();
    });

    it('force=true cancels the ride first (cancelledBy=admin), then suspends', async () => {
      drivers.findOne.mockResolvedValue(driverFixture());
      rides.findOne.mockResolvedValue(activeRideFixture());

      await service.suspend('drv-1', 'admin-1', { force: true });

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
});
