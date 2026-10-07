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
import { RouteDistanceService } from '../rides/route-distance.service';

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
  let routes: Record<string, jest.Mock>;

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
    payments = { update: jest.fn().mockResolvedValue({ affected: 1 }), find: jest.fn().mockResolvedValue([]) };
    // R-7: routed distance for the booking estimate / outlier flag.
    routes = { routedKm: jest.fn().mockResolvedValue(10) };

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
      routes as unknown as RouteDistanceService,
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

  // R-7: the outlier flag is based on the ROUTED distance (Mapbox via
  // RouteDistanceService, straight-line x1.3 fallback), not straight-line.
  describe('ride detail distance outlier (R-7)', () => {
    const rideFixture = (overrides: Record<string, unknown> = {}) => ({
      id: 'ride-9',
      status: 'completed',
      riderId: 'rider-1',
      driverId: 'drv-1',
      vehicleType: 'auto',
      distanceKm: '50.00',
      pickup: { address: 'Point A', lat: 12.9, lng: 77.6 },
      dropoff: { address: 'Point B', lat: 13.0, lng: 77.5 },
      fareBreakdown: { total: 250 },
      paymentStatus: 'paid',
      createdAt: new Date('2026-01-01'),
      ...overrides,
    });

    it('flags a recorded distance above routed x1.5', async () => {
      rides.findOne.mockResolvedValue(rideFixture()); // 50 km recorded
      routes.routedKm.mockResolvedValue(10); // routed 10 km -> threshold 15

      const detail = await service.getRideDetail('ride-9');

      expect(routes.routedKm).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 12.9 }),
        expect.objectContaining({ lat: 13.0 }),
      );
      expect(detail.distanceOutlier).toBe(true);
    });

    it('does not flag a distance within the routed bound', async () => {
      rides.findOne.mockResolvedValue(rideFixture({ distanceKm: '12.00' }));
      routes.routedKm.mockResolvedValue(10); // threshold 15

      const detail = await service.getRideDetail('ride-9');

      expect(detail.distanceOutlier).toBe(false);
    });

    it('never flags rides that are not completed yet', async () => {
      rides.findOne.mockResolvedValue(rideFixture({ status: 'in_progress' }));
      routes.routedKm.mockResolvedValue(10);

      const detail = await service.getRideDetail('ride-9');

      expect(detail.distanceOutlier).toBe(false);
    });
  });
});

/**
 * Task 9: GET /admin/users (search / role / batched ride counts) and
 * GET /admin/rides/export.csv (same filters as the console list, RFC 4180
 * CSV with the formula guard, phones never exported).
 */
describe('AdminService users list + rides CSV export (Task 9)', () => {
  let service: AdminService;
  let users: Record<string, jest.Mock>;
  let rides: Record<string, jest.Mock>;
  let qb: Record<string, jest.Mock>;

  const CSV_HEADER =
    'rideId,status,vehicleType,riderId,riderName,driverId,driverName,pickupAddress,dropoffAddress,' +
    'distanceKm,fareTotal,tipAmount,promoCode,paymentStatus,paymentMethod,paymentMarkedBy,' +
    'createdAt,completedAt,cancelledAt,cancelledBy,cancellationReason';

  const makeQb = () => {
    const chain: Record<string, jest.Mock> = {};
    for (const method of [
      'leftJoinAndSelect',
      'andWhere',
      'select',
      'addSelect',
      'where',
      'groupBy',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      chain[method] = jest.fn(() => chain);
    }
    chain.getMany = jest.fn().mockResolvedValue([]);
    chain.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    chain.getRawMany = jest.fn().mockResolvedValue([]);
    return chain;
  };

  beforeEach(() => {
    qb = makeQb();
    users = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    rides = { createQueryBuilder: jest.fn(() => qb) };

    service = new AdminService(
      users as unknown as Repository<UserEntity>,
      {} as unknown as Repository<DriverEntity>,
      rides as unknown as Repository<RideEntity>,
      {} as unknown as Repository<PaymentEntity>,
      {} as unknown as GeoService,
      {} as unknown as StorageService,
      {} as unknown as RidesGateway,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {} as unknown as AdminAuditService,
      {} as unknown as RidesService,
      { routedKm: jest.fn().mockResolvedValue(10) } as unknown as RouteDistanceService,
    );
  });

  describe('listUsers', () => {
    it('returns a page with batched ride counts and null roles defaulting to rider', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      users.findAndCount.mockResolvedValue([
        [
          { id: 'u1', name: 'Asha', phone: '9876543210', email: null, role: 'rider', isActive: true, createdAt },
          { id: 'u2', name: 'Kumar', phone: null, email: 'k@example.com', role: null, isActive: false, createdAt },
        ],
        42,
      ]);
      qb.getRawMany.mockResolvedValue([{ userId: 'u1', rideCount: '7' }]);

      const page = await service.listUsers({ page: 2, limit: 10 });

      expect(page).toMatchObject({ total: 42, page: 2, limit: 10 });
      expect(page.items[0]).toEqual({
        id: 'u1',
        name: 'Asha',
        phone: '9876543210',
        email: null,
        role: 'rider',
        isActive: true,
        createdAt,
        rideCount: 7, // raw COUNT(*)::int string coerced to a number
      });
      expect(page.items[1]).toEqual(
        expect.objectContaining({ id: 'u2', role: 'rider', phone: null, rideCount: 0 }),
      );
      expect(users.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        skip: 10,
        take: 10,
      });
      // One grouped query for the whole page — no N+1.
      expect(qb.where).toHaveBeenCalledWith('r."riderId" IN (:...ids)', { ids: ['u1', 'u2'] });
      expect(qb.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('searches name/phone/email with escaped LIKE patterns + role filter', async () => {
      users.findAndCount.mockResolvedValue([[], 0]);

      await service.listUsers({ q: '50%_x', role: 'admin' });

      const arg = users.findAndCount.mock.calls[0][0] as {
        where: Array<{ name?: { value: string }; phone?: unknown; email?: unknown; role?: string }>;
      };
      expect(arg.where).toHaveLength(3); // OR across the three columns
      expect(arg.where[0].name?.value).toBe('%50\\%\\_x%'); // % and _ escaped
      expect(arg.where[1].phone).toBeDefined();
      expect(arg.where[2].email).toBeDefined();
      for (const clause of arg.where) expect(clause.role).toBe('admin');
      expect(qb.getRawMany).not.toHaveBeenCalled(); // empty page, no count query
    });
  });

  describe('exportRidesCsv', () => {
    const rideFixture = () => ({
      id: 'ride-1',
      status: 'completed',
      vehicleType: 'sedan',
      riderId: 'r1',
      // Phone present on the relation — must NOT reach the CSV (ride-list rule).
      rider: { name: 'Asha, Kumar', phone: '9876543210' },
      driverId: 'd1',
      driver: { user: { name: 'Vijay "V"' } },
      pickup: { address: '12 MG Road, Salem' },
      dropoff: { address: 'Central Bus Stand' },
      distanceKm: '12.50',
      fareBreakdown: { total: 250 },
      tipAmount: 10,
      promoCode: 'VAZHI20',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      paymentMarkedBy: 'driver',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      completedAt: new Date('2026-02-01T10:25:00Z'),
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
    });

    it('exports filtered rides with shared filters, escaped cells and no phones', async () => {
      qb.getMany.mockResolvedValue([rideFixture()]);

      const { filename, csv, truncated } = await service.exportRidesCsv({ status: 'completed', q: 'asha' });

      expect(truncated).toBe(false);
      expect(filename).toMatch(/^vazhi-rides-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(csv.startsWith('\uFEFF')).toBe(true); // Excel UTF-8 detection
      const [header, row] = csv.slice(1).split('\r\n');
      expect(header).toBe(CSV_HEADER);
      expect(row).toContain('"12 MG Road, Salem"'); // comma → quoted
      expect(row).toContain('Vijay ""V"""'); // quotes doubled
      expect(row).toContain('VAZHI20');
      expect(row).toContain('250'); // fareTotal from fareBreakdown
      expect(row).not.toContain('9876543210'); // phones never exported

      // Same whitelist builder as GET /admin/rides + the export cap.
      expect(qb.andWhere).toHaveBeenCalledWith('r.status IN (:...statuses)', {
        statuses: ['completed'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :q'), {
        q: '%asha%',
      });
      // Cap is 5 000; one extra row is requested to detect truncation.
      expect(qb.take).toHaveBeenCalledWith(5_001);
    });

    it('flags truncation and exports exactly the cap when more rows match', async () => {
      qb.getMany.mockResolvedValue(Array.from({ length: 5_001 }, () => rideFixture()));

      const { csv, truncated } = await service.exportRidesCsv();

      expect(truncated).toBe(true);
      // header + exactly 5 000 data rows (+ trailing CRLF -> one empty tail item)
      expect(csv.slice(1).split('\r\n')).toHaveLength(1 + 5_000 + 1);
    });

    it('rejects unknown filter values (identical whitelist to the list)', async () => {
      await expect(service.exportRidesCsv({ status: 'warp' })).rejects.toThrow(
        BadRequestException,
      );
      expect(qb.getMany).not.toHaveBeenCalled();
    });

    it('emits header-only CSV for an empty result', async () => {
      qb.getMany.mockResolvedValue([]);

      const { csv } = await service.exportRidesCsv();

      expect(csv).toBe(`\uFEFF${CSV_HEADER}\r\n`);
    });
  });

  describe('listRides (refactored onto ridesFilterQb)', () => {
    it('still pages, orders and clamps through the shared builder', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 5]);

      const page = await service.listRides({ status: 'completed', page: 2, limit: 10 });

      expect(page).toEqual({ items: [], total: 5, page: 2, limit: 10 });
      expect(qb.andWhere).toHaveBeenCalledWith('r.status IN (:...statuses)', {
        statuses: ['completed'],
      });
      expect(qb.orderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.getManyAndCount).toHaveBeenCalledTimes(1);
    });
  });
});
