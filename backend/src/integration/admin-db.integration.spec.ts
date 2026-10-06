import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { AdminService } from '../admin/admin.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { GeoService } from '../drivers/geo.service';
import { StorageService } from '../drivers/storage.service';
import { PaymentEntity } from '../payments/entities/payment.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { RidesGateway } from '../rides/gateway/rides.gateway';
import { RidesService } from '../rides/rides.service';
import { RouteDistanceService } from '../rides/route-distance.service';
import { createTestDataSource, integrationEnabled, wipeTestTables } from './db-helpers';

/**
 * Task 11 — admin users list + rides CSV export against a REAL Postgres:
 * escaped ILIKE, role filter, grouped ride counts and CSV privacy/escaping
 * proven with real SQL instead of mocked query builders.
 * Opt-in only: `INTEGRATION=1 npm run test:integration`.
 */
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('admin users + rides CSV against real Postgres (INTEGRATION=1)', () => {
  let ds: DataSource;
  let service: AdminService;
  let users: Repository<UserEntity>;
  let rides: Repository<RideEntity>;

  const makeRide = (riderId: string, overrides: Partial<RideEntity> = {}): Promise<RideEntity> =>
    rides.save(
      rides.create({
        riderId,
        status: 'completed',
        vehicleType: 'sedan',
        pickup: { address: '12 MG Road, Salem', lat: 11.66, lng: 78.15 },
        dropoff: { address: 'Central Bus Stand', lat: 11.67, lng: 78.16 },
        distanceKm: '12.50',
        promoCode: 'VAZHI20',
        fareBreakdown: { baseFare: 100, distanceFare: 100, timeCharge: 20, tollFee: 0, taxes: 30, discount: 0, total: 250 },
        ...overrides,
      }),
    );

  beforeAll(async () => {
    ds = await createTestDataSource();
    users = ds.getRepository(UserEntity);
    rides = ds.getRepository(RideEntity);

    service = new AdminService(
      users,
      ds.getRepository(DriverEntity),
      rides,
      ds.getRepository(PaymentEntity),
      {} as unknown as GeoService,
      {} as unknown as StorageService,
      {} as unknown as RidesGateway,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {} as unknown as AdminAuditService,
      {} as unknown as RidesService,
      { routedKm: jest.fn().mockResolvedValue(10) } as unknown as RouteDistanceService,
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await wipeTestTables(ds);
  });

  it('searches name/phone/email with literal % and _ (escaped ILIKE)', async () => {
    await users.save(users.create({ name: 'Store 50%_off', phone: '9840000001' }));
    await users.save(users.create({ name: 'Store 50Xoff', phone: '9840000002' }));

    const page = await service.listUsers({ q: '50%_' });

    // Unescaped, `%`/`_` are wildcards and "Store 50Xoff" would match too.
    expect(page.total).toBe(1);
    expect(page.items[0].name).toBe('Store 50%_off');
  });

  it('filters by role, pages, and grouped-counts rides per rider', async () => {
    const rider1 = await users.save(users.create({ name: 'Asha', phone: '9840000011', role: 'rider' }));
    await users.save(users.create({ name: 'Kumar', phone: '9840000012', role: 'rider' }));
    await users.save(users.create({ name: 'Root', phone: '9840000013', role: 'admin' }));
    await makeRide(rider1.id);
    await makeRide(rider1.id);

    const admins = await service.listUsers({ role: 'admin' });
    expect(admins.total).toBe(1);
    expect(admins.items[0].name).toBe('Root');

    const page1 = await service.listUsers({ role: 'rider', limit: 1, page: 1 });
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    expect(page1.page).toBe(1);

    const withCounts = await service.listUsers({ q: 'Asha' });
    expect(withCounts.items[0].rideCount).toBe(2);
    const withoutCounts = await service.listUsers({ q: 'Kumar' });
    expect(withoutCounts.items[0].rideCount).toBe(0); // grouped count, missing => 0
  });

  it('exports CSV with quoted cells, no phones, and the shared filter whitelist', async () => {
    const rider = await users.save(
      users.create({ name: 'Asha, Kumar', phone: '9876543210' }),
    );
    await makeRide(rider.id);
    await makeRide(rider.id, { status: 'requested' }); // filtered out by status=completed

    const { filename, csv } = await service.exportRidesCsv({ status: 'completed' });

    expect(filename).toMatch(/^vazhi-rides-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.startsWith('\uFEFF')).toBe(true); // Excel UTF-8 detection

    const lines = csv.slice(1).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2); // header + the single completed ride
    expect(lines[0]).toContain('rideId,status,vehicleType');
    expect(lines[1]).toContain('"12 MG Road, Salem"'); // comma → RFC 4180 quotes
    expect(lines[1]).toContain('"Asha, Kumar"'); // rider name quoted too
    expect(lines[1]).toContain('VAZHI20'); // promo column
    expect(lines[1]).not.toContain('9876543210'); // phones never exported

    // Same whitelist as GET /admin/rides — real BadRequestException path.
    await expect(service.exportRidesCsv({ status: 'warp' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
