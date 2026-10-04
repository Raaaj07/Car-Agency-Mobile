import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { DriversService } from './drivers.service';
import { DriverEntity } from './entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { GeoService } from './geo.service';
import { StorageService } from './storage.service';

/**
 * R-3: a driver mid-trip must not re-enter the available pool by toggling
 * online. Going offline mid-trip stays allowed (with isAvailable forced off).
 */
describe('DriversService.setStatus (R-3)', () => {
  let service: DriversService;
  let drivers: Record<string, jest.Mock>;
  let rides: Record<string, jest.Mock>;
  let geo: Record<string, jest.Mock>;

  const driverFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'd1',
    userId: 'u1',
    status: 'approved',
    isOnline: false,
    isAvailable: false,
    vehicleType: 'auto',
    location: { coordinates: [77.1, 28.6] }, // [lng, lat]
    locationUpdatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    drivers = {
      findOne: jest.fn(),
      save: jest.fn(async (d) => d),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    rides = { findOne: jest.fn().mockResolvedValue(null) };
    geo = {
      upsertDriverLocation: jest.fn().mockResolvedValue(undefined),
      removeDriver: jest.fn().mockResolvedValue(undefined),
    };

    service = new DriversService(
      drivers as unknown as Repository<DriverEntity>,
      rides as unknown as Repository<RideEntity>,
      geo as unknown as GeoService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {} as unknown as StorageService,
    );
  });

  it('refuses to go online while on an active trip', async () => {
    drivers.findOne.mockResolvedValue(driverFixture({ isOnline: false }));
    rides.findOne.mockResolvedValue({ id: 'ride-1', status: 'in_progress', driverId: 'd1' });

    await expect(service.setStatus('u1', true)).rejects.toThrow(ConflictException);
    expect(drivers.save).not.toHaveBeenCalled();
    expect(geo.upsertDriverLocation).not.toHaveBeenCalled();
  });

  it('refuses to go online from matched / driver_en_route too', async () => {
    drivers.findOne.mockResolvedValue(driverFixture());
    rides.findOne.mockResolvedValue({ id: 'ride-1', status: 'matched', driverId: 'd1' });

    await expect(service.setStatus('u1', true)).rejects.toThrow(ConflictException);
    expect(drivers.save).not.toHaveBeenCalled();
  });

  it('goes online normally when no trip is active', async () => {
    drivers.findOne.mockResolvedValue(driverFixture());
    rides.findOne.mockResolvedValue(null);

    const result = await service.setStatus('u1', true);

    expect(result.isOnline).toBe(true);
    expect(result.isAvailable).toBe(true);
    expect(geo.upsertDriverLocation).toHaveBeenCalledWith('d1', 'auto', 28.6, 77.1);
  });

  it('stays allowed to go offline mid-trip, with availability forced off', async () => {
    const driver = driverFixture({ isOnline: true, isAvailable: true });
    drivers.findOne.mockResolvedValue(driver);
    rides.findOne.mockResolvedValue({ id: 'ride-1', status: 'driver_en_route', driverId: 'd1' });

    const result = await service.setStatus('u1', false);

    expect(result.isOnline).toBe(false);
    expect(result.isAvailable).toBe(false);
    expect(geo.removeDriver).toHaveBeenCalledWith('d1', 'auto');
    // Offline toggle is not blocked by the trip — the ride status still owns
    // the trip, but the driver must not be handed a second offer.
    expect(drivers.save).toHaveBeenCalled();
  });
});
