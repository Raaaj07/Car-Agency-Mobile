import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { AddPromosTables1791300000000 } from '../database/migrations/1791300000000-AddPromosTables';
import { PromoAdminDto } from '../promos/dto/promo-admin.dto';
import { PromoEntity } from '../promos/entities/promo.entity';
import { PromoRedemptionEntity } from '../promos/entities/promo-redemption.entity';
import { PromosService } from '../promos/promos.service';
import { RideEntity } from '../rides/entities/ride.entity';
import { createTestDataSource, integrationEnabled, wipeTestTables } from './db-helpers';

/**
 * Task 11 — promos against a REAL Postgres: everything the unit suite mocks
 * (unique index, FK SET NULL, transaction participation, ILIKE windows).
 * Opt-in only: `INTEGRATION=1 npm run test:integration`.
 */
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('promos against real Postgres (INTEGRATION=1)', () => {
  let ds: DataSource;
  let service: PromosService;
  let promoRepo: Repository<PromoEntity>;
  let ridesRepo: Repository<RideEntity>;
  let usersRepo: Repository<UserEntity>;

  const dto = (overrides: Partial<PromoAdminDto> = {}): PromoAdminDto => ({
    code: 'SUMMER10',
    discountAmount: 10,
    ...overrides,
  });

  const makeRide = (riderId: string): Promise<RideEntity> =>
    ridesRepo.save(
      ridesRepo.create({
        riderId,
        status: 'completed',
        vehicleType: 'auto',
        pickup: { address: 'Pickup, Salem', lat: 11.66, lng: 78.15 },
        dropoff: { address: 'Dropoff', lat: 11.67, lng: 78.16 },
        fareBreakdown: { baseFare: 50, distanceFare: 30, timeCharge: 10, tollFee: 0, taxes: 5, discount: 0, total: 95 },
      }),
    );

  beforeAll(async () => {
    ds = await createTestDataSource();
    promoRepo = ds.getRepository(PromoEntity);
    ridesRepo = ds.getRepository(RideEntity);
    usersRepo = ds.getRepository(UserEntity);
    service = new PromosService(ridesRepo, promoRepo);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await wipeTestTables(ds);
  });

  it('migration AddPromosTables seeds VAZHI20 with the original config copy', async () => {
    // The row is wiped between runs (migrations only ever execute once), so
    // re-apply the migration itself — it is idempotent (IF NOT EXISTS +
    // ON CONFLICT DO NOTHING), which is exactly the behaviour under test.
    const qr = ds.createQueryRunner();
    try {
      await new AddPromosTables1791300000000().up(qr);
    } finally {
      await qr.release();
    }

    const vazhi = await promoRepo.findOne({ where: { code: 'VAZHI20' } });
    expect(vazhi).not.toBeNull();
    expect(vazhi?.discountAmount).toBe(20);
    expect(vazhi?.firstRideOnly).toBe(true);
    expect(vazhi?.active).toBe(true);
    expect(vazhi?.title).toBe('Rs 20 off your first ride');
    expect(vazhi?.subtitle).toBe('Tap to apply code VAZHI20');
    expect(vazhi?.cta).toBe('Apply');
  });

  it('enforces the unique code index at the database level', async () => {
    await promoRepo.save(promoRepo.create({ code: 'DUP1', discountAmount: 5 }));

    await expect(promoRepo.save(promoRepo.create({ code: 'DUP1', discountAmount: 7 }))).rejects.toThrow(
      /duplicate key/,
    );
    expect(await promoRepo.count()).toBe(1);
  });

  it('createPromo answers 409 for a duplicate code regardless of case/space', async () => {
    await service.createPromo(dto());

    await expect(service.createPromo(dto({ code: ' summer10 ' }))).rejects.toThrow(ConflictException);
    expect(await promoRepo.count()).toBe(1); // nothing half-written
  });

  it('resolveDiscount enforces window, first-ride and cap against real rows', async () => {
    // Expired validity window.
    await service.createPromo(
      dto({ code: 'OLD10', validTo: new Date(Date.now() - 86_400_000).toISOString() }),
    );
    await expect(service.resolveDiscount('OLD10', 'rider-none')).rejects.toThrow('has expired.');

    // First-ride-only: eligible before a completed ride, rejected after one.
    const rider = await usersRepo.save(
      usersRepo.create({ name: 'Asha', phone: '9840012345', role: 'rider' }),
    );
    await service.createPromo(dto({ code: 'FIRST20', discountAmount: 20, firstRideOnly: true }));
    expect(await service.resolveDiscount('FIRST20', rider.id)).toBe(20);
    await makeRide(rider.id);
    await expect(service.resolveDiscount('FIRST20', rider.id)).rejects.toThrow(
      'only valid for your first ride.',
    );

    // Redemption cap reached after one real redemption row.
    await service.createPromo(dto({ code: 'ONCE5', discountAmount: 5, maxRedemptions: 1 }));
    const other = await usersRepo.save(usersRepo.create({ name: 'Kumar', phone: '9840054321' }));
    const ride = await makeRide(other.id);
    await service.recordRedemption('ONCE5', ride.id, other.id);
    await expect(service.resolveDiscount('ONCE5', 'anyone')).rejects.toThrow(
      'redemption limit',
    );
  });

  it('recordRedemption commits or rolls back together with the caller transaction', async () => {
    const promo = await service.createPromo(dto({ code: 'TXN5', discountAmount: 5 }));
    const rider = await usersRepo.save(usersRepo.create({ name: 'Ravi' }));
    const ride = await makeRide(rider.id);

    // Committed transaction: counter moves.
    await ds.transaction((mgr) => service.recordRedemption('TXN5', ride.id, rider.id, mgr));
    let row = await promoRepo.findOne({ where: { id: promo.id } });
    expect(row?.redemptionCount).toBe(1);

    // Rolled-back transaction: counter must NOT move (atomicity with the fare write).
    await ds
      .transaction(async (mgr) => {
        await service.recordRedemption('TXN5', ride.id, rider.id, mgr);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    row = await promoRepo.findOne({ where: { id: promo.id } });
    expect(row?.redemptionCount).toBe(1);
    expect(await ds.getRepository(PromoRedemptionEntity).count()).toBe(1);
  });

  it('deleting a promo keeps redemption history (SET NULL + denormalised code)', async () => {
    const promo = await service.createPromo(dto({ code: 'HIST5', discountAmount: 5 }));
    const rider = await usersRepo.save(usersRepo.create({ name: 'Meena' }));
    const ride = await makeRide(rider.id);
    await service.recordRedemption('HIST5', ride.id, rider.id);

    await service.removePromo(promo.id);

    const history = await ds.getRepository(PromoRedemptionEntity).find();
    expect(history).toHaveLength(1);
    expect(history[0].promoId).toBeNull(); // FK really is ON DELETE SET NULL
    expect(history[0].code).toBe('HIST5'); // denormalised copy survives
    expect(history[0].discountAmount).toBe(5);
  });
});
