import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AdminService } from '../admin/admin.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { UserEntity } from '../auth/entities/user.entity';
import { ApplicationEventsService } from '../common/events/application-events.service';
import { DriversService } from '../drivers/drivers.service';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { GeoService } from '../drivers/geo.service';
import { StorageService } from '../drivers/storage.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentEntity } from '../payments/entities/payment.entity';
import { PaymentProvider } from '../payments/providers/payment-provider.interface';
import { PromosService } from '../promos/promos.service';
import { RidesService } from '../rides/rides.service';
import { RouteDistanceService } from '../rides/route-distance.service';
import { RideEntity } from '../rides/entities/ride.entity';
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';
import { RidesGateway } from '../rides/gateway/rides.gateway';

/**
 * T-1: one happy-path scenario through the REAL services (shared in-memory
 * rows instead of a database):
 *
 *   apply → approve (approvedAt stamped) → driver goes online →
 *   rider books (driver offered) → accept → markEnRoute → start →
 *   pickup OTP → complete → rider claims cash (rider_claimed) →
 *   driver confirms Amount Received (paid, markedBy=driver)
 *
 * The rejection branch is asserted too: an unapproved driver cannot go online
 * (and a second application while pending is refused).
 */
type RideRow = RideEntity;
type DriverRow = DriverEntity;

type RidesInternals = {
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

const ACTIVE_RIDE_STATUSES = ['requested', 'matched', 'driver_en_route', 'in_progress'];

describe('E2E happy path (T-1): apply → approve → online → book → trip → pay', () => {
  // Shared "database" — every repo method reads/writes these rows.
  let driverRow: DriverRow | null;
  let rideRow: RideRow | null;
  let driverSeq = 0;

  let driversRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    findNearby: jest.Mock;
    setAvailability: jest.Mock;
    findByUserId: jest.Mock;
    findById: jest.Mock;
    getDriverIdsByUserIds: jest.Mock;
    find: jest.Mock;
  };
  let ridesRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    manager: { connection: { createQueryRunner: jest.Mock } };
  };
  let paymentsRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let geo: Record<string, jest.Mock>;
  let gateway: Record<string, jest.Mock>;
  let storage: Record<string, jest.Mock>;
  let provider: Record<string, jest.Mock>;
  let queryRunner: QueryRunnerStub;

  let driversService: DriversService;
  let adminService: AdminService;
  let ridesService: RidesService;
  let paymentsService: PaymentsService;
  let internals: RidesInternals;

  const DRIVER_USER = 'drv-user-1';
  const RIDER_USER = 'rider-user-1';
  const ADMIN_USER = 'admin-user-1';

  const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;

  beforeEach(() => {
    driverSeq = 0;
    driverRow = null;
    rideRow = null;

    driversRepo = {
      findOne: jest.fn(async (args?: { where?: Record<string, unknown> }) => {
        if (!driverRow) return null;
        const where = args?.where ?? {};
        if (typeof where.userId === 'string' && where.userId !== driverRow.userId) return null;
        if (typeof where.id === 'string' && where.id !== driverRow.id) return null;
        return driverRow;
      }),
      create: jest.fn((fields: Record<string, unknown>) => {
        driverSeq += 1;
        return { id: `drv-${driverSeq}`, ...fields } as DriverRow;
      }),
      save: jest.fn(async (d: DriverRow) => {
        driverRow = d;
        return d;
      }),
      update: jest.fn(async (where: { id: string }, partial: Partial<DriverRow>) => {
        if (driverRow && driverRow.id === where.id) Object.assign(driverRow, partial);
        return { affected: 1 };
      }),
      findNearby: jest.fn(async () => {
        if (!driverRow || !driverRow.isOnline || !driverRow.isAvailable || driverRow.status !== 'approved') {
          return [];
        }
        return [
          {
            driverId: driverRow.id,
            userId: driverRow.userId,
            vehicleType: driverRow.vehicleType,
            name: 'Happy',
            rating: 5,
            distanceMeters: 400,
            etaMinutes: 2,
            lat: 12.9,
            lng: 77.6,
          },
        ];
      }),
      setAvailability: jest.fn(async (id: string, available: boolean) => {
        if (driverRow && driverRow.id === id) driverRow.isAvailable = available;
      }),
      findByUserId: jest.fn(async (userId: string) => {
        if (driverRow && driverRow.userId === userId) return driverRow;
        throw new Error('Driver profile not found for this user');
      }),
      findById: jest.fn(async (id: string) => {
        if (driverRow && driverRow.id === id) return driverRow;
        throw new Error('Driver not found');
      }),
      getDriverIdsByUserIds: jest.fn(async () => []),
      // hydrateFromRedis re-reads rows by id (relations ignored).
      find: jest.fn(async () => (driverRow ? [driverRow] : [])),
    };

    ridesRepo = {
      findOne: jest.fn(async () => rideRow),
      find: jest.fn(async () => []),
      count: jest.fn(async (args?: { where?: { riderId?: string } }) => {
        if (
          rideRow &&
          args?.where?.riderId === rideRow.riderId &&
          ACTIVE_RIDE_STATUSES.includes(rideRow.status)
        ) {
          return 1;
        }
        return 0;
      }),
      create: jest.fn((fields: Record<string, unknown>) => ({
        id: 'ride-e2e',
        createdAt: new Date(),
        ...fields,
      })) as unknown as jest.Mock,
      save: jest.fn(async (r: RideRow) => {
        rideRow = r;
        return r;
      }),
      update: jest.fn(async (where: { id: string }, partial: Partial<RideRow>) => {
        if (rideRow && rideRow.id === where.id) Object.assign(rideRow, partial);
        return { affected: 1 };
      }),
      manager: { connection: { createQueryRunner: jest.fn() } },
    };

    paymentsRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((p: Record<string, unknown>) => p),
      save: jest.fn(async (p: PaymentEntity) => ({ ...p, id: p.id ?? 'pay-e2e' })),
    };

    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        findOne: jest.fn(async () => rideRow),
        save: jest.fn(async (r: RideRow) => {
          rideRow = r;
          return r;
        }),
      },
    };
    (ridesRepo.manager.connection.createQueryRunner as jest.Mock).mockReturnValue(queryRunner);

    geo = {
      upsertDriverLocation: jest.fn().mockResolvedValue(undefined),
      removeDriver: jest.fn().mockResolvedValue(undefined),
      // Redis GEOSEARCH stand-in: report our online driver as nearby.
      searchNearby: jest.fn(async () =>
        driverRow && driverRow.isOnline && driverRow.isAvailable
          ? [{ driverId: driverRow.id, lat: 12.9, lng: 77.6, distanceMeters: 400 }]
          : [],
      ),
    };
    gateway = {
      emitRideStatus: jest.fn(),
      emitRideRequestToDriver: jest.fn(),
      emitDriverStatus: jest.fn(),
    };
    storage = {
      deleteDocument: jest.fn().mockResolvedValue(undefined),
      getDocumentAccess: jest.fn().mockResolvedValue({ mode: 'sign' }),
    };
    provider = {
      createOrder: jest.fn(),
      verifyPayment: jest.fn(),
      providerKey: jest.fn().mockReturnValue('rzp_key'),
    };

    const usersRepo = {} as unknown as Repository<UserEntity>;

    driversService = new DriversService(
      driversRepo as unknown as Repository<DriverEntity>,
      ridesRepo as unknown as Repository<RideEntity>,
      { save: jest.fn(async (row: unknown) => row) } as unknown as Repository<AdminAuditLogEntity>,
      geo as unknown as GeoService,
      config,
      storage as unknown as StorageService,
      { emitApplicationNew: jest.fn() } as unknown as ApplicationEventsService,
    );
    adminService = new AdminService(
      usersRepo,
      driversRepo as unknown as Repository<DriverEntity>,
      ridesRepo as unknown as Repository<RideEntity>,
      paymentsRepo as unknown as Repository<PaymentEntity>,
      geo as unknown as GeoService,
      storage as unknown as StorageService,
      gateway as unknown as RidesGateway,
      config,
      { log: jest.fn().mockResolvedValue(undefined) } as unknown as AdminAuditService,
      { clearPendingTimers: jest.fn() } as unknown as RidesService,
      { routedKm: jest.fn().mockResolvedValue(10) } as unknown as RouteDistanceService,
    );
    ridesService = new RidesService(
      ridesRepo as unknown as Repository<RideEntity>,
      driversService,
      geo as unknown as GeoService,
      gateway as unknown as RidesGateway,
      config,
      { resolveDiscount: jest.fn().mockResolvedValue(0), discountFor: jest.fn().mockReturnValue(0) } as unknown as PromosService,
      { routedKm: jest.fn().mockResolvedValue(10) } as unknown as RouteDistanceService,
    );
    paymentsService = new PaymentsService(
      paymentsRepo as unknown as Repository<PaymentEntity>,
      ridesRepo as unknown as Repository<RideEntity>,
      provider as unknown as PaymentProvider,
    );
    internals = ridesService as unknown as RidesInternals;

    jest.useFakeTimers();
  });

  afterEach(() => {
    ridesService.onModuleDestroy();
    jest.useRealTimers();
  });

  it('runs the full lifecycle from application to settled payment', async () => {
    // 1. Driver applies (multipart application, docs stored as path strings).
    const applied = await driversService.applyApplication(
      DRIVER_USER,
      { vehicleType: 'auto', carModel: 'WagonR', plateNumber: 'KA-01-1234', licenseNumber: 'DL777' },
      { licenseImagePath: 'lic.png', rcImagePath: 'rc.png', vehiclePhotoPath: 'car.png' },
    );
    expect(applied.status).toBe('pending');

    // 2. Re-submitting while pending is refused (A-2-adjacent guard).
    await expect(
      driversService.applyApplication(
        DRIVER_USER,
        { vehicleType: 'auto', carModel: 'WagonR', plateNumber: 'KA-01-1234', licenseNumber: 'DL777' },
        { licenseImagePath: 'lic2.png', rcImagePath: 'rc2.png', vehiclePhotoPath: 'car2.png' },
      ),
    ).rejects.toThrow(ConflictException);

    // 3. A pending driver cannot go online before approval.
    await expect(driversService.setStatus(DRIVER_USER, true)).rejects.toThrow(ConflictException);

    // 4. Admin approves → status + approvedAt stamped (A-2 prerequisite).
    const approved = await adminService.approve(applied.id, ADMIN_USER);
    expect(approved.status).toBe('approved');
    expect(driverRow?.approvedAt).toBeInstanceOf(Date);
    expect(gateway.emitDriverStatus).toHaveBeenCalledWith(DRIVER_USER, { status: 'approved' });

    // 5. Driver goes online (fresh location, no active ride).
    driverRow!.location = { type: 'Point', coordinates: [77.6, 12.9] };
    driverRow!.locationUpdatedAt = new Date();
    const online = await driversService.setStatus(DRIVER_USER, true);
    expect(online.isOnline).toBe(true);
    expect(online.isAvailable).toBe(true);

    // 6. Rider books → the online driver is offered the ride (R-1 'offered').
    const booked = await ridesService.create(RIDER_USER, {
      pickup: { address: 'Point A', lat: 12.9, lng: 77.6 },
      dropoff: { address: 'Point B', lat: 13.0, lng: 77.5 },
      vehicleType: 'auto',
      paymentMethod: 'upi',
      allowUpgrade: true,
    });
    expect(booked.match).toEqual({ status: 'offered', candidates: 1 });
    expect(rideRow?.status).toBe('requested');
    expect(rideRow?.driverId).toBe(driverRow?.id);
    // Offer reservation: driver pulled out of the available pool + 15 s timer.
    expect(driverRow?.isAvailable).toBe(false);
    expect(internals.offerTimeouts.has(rideRow!.id)).toBe(true);

    // 7. Driver accepts → matched, pickup OTP generated.
    const accepted = await ridesService.accept(rideRow!.id, DRIVER_USER);
    expect(accepted.status).toBe('matched');
    expect(rideRow?.status).toBe('matched');
    expect(rideRow?.pickupOtp).toMatch(/^\d{4}$/);
    expect(internals.offerTimeouts.has(rideRow!.id)).toBe(false);

    // 8. En route → start → OTP verification begins.
    await ridesService.markEnRoute(rideRow!.id, DRIVER_USER);
    expect(rideRow?.status).toBe('driver_en_route');
    const started = await ridesService.start(rideRow!.id, DRIVER_USER);
    expect(started.readyForOtp).toBe(true);

    // 9. Correct pickup OTP → trip in progress.
    await ridesService.verifyPickupOtp(rideRow!.id, DRIVER_USER, { otp: rideRow!.pickupOtp! });
    expect(rideRow?.status).toBe('in_progress');
    expect(rideRow?.startedAt).toBeInstanceOf(Date);

    // 10. Complete → final fare, driver freed, status completed.
    await ridesService.complete(rideRow!.id, DRIVER_USER, {});
    expect(rideRow?.status).toBe('completed');
    expect(rideRow?.completedAt).toBeInstanceOf(Date);
    expect(Number(rideRow!.fareBreakdown.total)).toBeGreaterThan(0);
    expect(driverRow?.isAvailable).toBe(true);

    // 11. Rider claims cash (P-1): rider_claimed, never paid.
    const claim = await paymentsService.createOrder(RIDER_USER, { rideId: rideRow!.id, method: 'cash' });
    expect(claim.status).toBe('rider_claimed');
    expect(rideRow?.paymentStatus).toBe('rider_claimed');
    expect(rideRow?.paymentMarkedBy).toBe('rider');

    // 12. Driver confirms "Amount Received" → settled, markedBy=driver.
    const settled = await ridesService.markPaymentReceived(rideRow!.id, DRIVER_USER);
    expect(settled.paymentStatus).toBe('paid');
    expect(rideRow?.paymentStatus).toBe('paid');
    expect(rideRow?.paymentMarkedBy).toBe('driver');

    // No timers left behind at the end of the lifecycle.
    expect(internals.offerTimeouts.size).toBe(0);
    expect(internals.searchTimeouts.size).toBe(0);
  });
});
