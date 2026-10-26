import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { DriversService } from './drivers.service';
import { DriverEntity } from './entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';
import { GeoService } from './geo.service';
import { StorageService } from './storage.service';
import { ApplicationEventsService } from '../common/events/application-events.service';

/**
 * R-3: a driver mid-trip must not re-enter the available pool by toggling
 * online. Going offline mid-trip stays allowed (with isAvailable forced off).
 */
describe('DriversService.setStatus (R-3)', () => {
  let service: DriversService;
  let drivers: Record<string, jest.Mock>;
  let rides: Record<string, jest.Mock>;
  let geo: Record<string, jest.Mock>;
  let audit: Record<string, jest.Mock>;

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
    audit = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (row: unknown) => row),
    };

    service = new DriversService(
      drivers as unknown as Repository<DriverEntity>,
      rides as unknown as Repository<RideEntity>,
      audit as unknown as Repository<AdminAuditLogEntity>,
      geo as unknown as GeoService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {} as unknown as StorageService,
      { emitApplicationNew: jest.fn() } as unknown as ApplicationEventsService,
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

  // SEC-6: the rider-facing nearby feed is redacted to dots + etas. Ride
  // matching keeps using the full internal findNearby().
  describe('findNearbyPublic (SEC-6 redaction)', () => {
    const hit = { driverId: 'd1', distanceMeters: 800, lat: 11.6643, lng: 78.146 };

    it('returns position + eta only — no ids, names, models or ratings', async () => {
      geo.searchNearby = jest.fn().mockResolvedValue([hit]);
      drivers.find = jest.fn().mockResolvedValue([
        driverFixture({
          isOnline: true,
          isAvailable: true,
          carModel: 'Tiago',
          rating: 4.8,
          user: { name: 'Priya' },
        }),
      ]);

      const list = await service.findNearbyPublic(11.6643, 78.146);

      expect(list).toEqual([
        { lat: 11.6643, lng: 78.146, vehicleType: 'auto', etaMinutes: expect.any(Number) },
      ]);
      // Belt and braces: none of the redacted identifiers survive serialization.
      expect(JSON.stringify(list)).not.toMatch(/d1|Priya|Tiago|4\.8/);
    });

    it('redacts the drivers array in the grouped response but keeps the counts', async () => {
      geo.searchNearby = jest.fn().mockResolvedValue([hit]);
      drivers.find = jest.fn().mockResolvedValue([
        driverFixture({ isOnline: true, isAvailable: true, user: { name: 'Arun' } }),
      ]);

      const grouped = (await service.findNearbyPublic(11.6643, 78.146, undefined, undefined, true)) as {
        drivers: unknown[];
        countsByType: Record<string, { count: number; bestEtaMinutes: number | null }>;
      };

      expect(grouped.countsByType.auto).toEqual({ count: 1, bestEtaMinutes: expect.any(Number) });
      expect(grouped.drivers).toEqual([
        { lat: 11.6643, lng: 78.146, vehicleType: 'auto', etaMinutes: expect.any(Number) },
      ]);
    });
  });

  // Pass-4 (task 6): soft fraud flag — an implied speed over 200 km/h
  // between consecutive pings (GPS spoofing / a location jump). Never blocks
  // the ping; at most one `location_jump` row per driver per hour.
  describe('updateLocation location_jump flag (pass-4 task-6)', () => {
    // The driver's previous ping: 60 s ago at the fixture location.
    const prevPing = (overrides: Record<string, unknown> = {}) =>
      driverFixture({ locationUpdatedAt: new Date(Date.now() - 60_000), ...overrides });

    it('flags an implied speed over 200 km/h on the driver', async () => {
      drivers.findOne.mockResolvedValue(prevPing());

      await service.updateLocation('u1', 28.6, 78.1); // ~98 km east in 60 s

      expect(audit.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ride_flag',
          targetType: 'driver',
          targetId: 'd1',
          reason: 'location_jump',
        }),
      );
    });

    it('does NOT flag normal movement', async () => {
      drivers.findOne.mockResolvedValue(prevPing());

      await service.updateLocation('u1', 28.6001, 77.1001); // metres in 60 s

      expect(audit.save).not.toHaveBeenCalled();
    });

    it('does NOT flag the first ping (no previous location)', async () => {
      drivers.findOne.mockResolvedValue(
        driverFixture({ location: null, locationUpdatedAt: null }),
      );

      await service.updateLocation('u1', 28.6, 78.1);

      expect(audit.save).not.toHaveBeenCalled();
    });

    it('flags at most once per hour per driver (dedup)', async () => {
      drivers.findOne.mockResolvedValue(prevPing());
      audit.findOne.mockResolvedValue({ id: 'audit-1' }); // already flagged this hour

      await service.updateLocation('u1', 28.6, 78.1);

      expect(audit.save).not.toHaveBeenCalled();
    });
  });
});
