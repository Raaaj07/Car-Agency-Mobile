import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { PromoAdminDto } from './dto/promo-admin.dto';
import { PromoEntity } from './entities/promo.entity';
import { PromoCard, PromosService } from './promos.service';

/**
 * Task 8 (PR-1): promos are DB rows — window/cap/first-ride eligibility,
 * async discountFor, atomic redemption recording, and admin CRUD.
 */
type PromoRow = PromoEntity;

const promoRow = (overrides: Partial<PromoRow> = {}): PromoRow => ({
  id: overrides.id ?? 'p1',
  code: 'VAZHI20',
  title: null,
  subtitle: null,
  cta: null,
  discountAmount: 20,
  firstRideOnly: false,
  active: true,
  validFrom: null,
  validTo: null,
  maxRedemptions: null,
  redemptionCount: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const matchWhere = (rows: PromoRow[], where: Record<string, unknown>): PromoRow | null =>
  rows.find((row) =>
    Object.entries(where).every(
      ([key, value]) => (row as unknown as Record<string, unknown>)[key] === value,
    ),
  ) ?? null;

/** Chainable stub for em.createQueryBuilder().update().set().where().execute(). */
const counterQb = () => {
  const qb = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  qb.update.mockReturnValue(qb);
  qb.set.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  return qb;
};

/** In-memory stand-in for the two repos PromosService touches. */
function buildService(promos: PromoRow[], completedRides = 0) {
  const saveMock = jest.fn(async (row: PromoRow) => {
    if (!row.id) row.id = `p${promos.length + 1}`;
    if (!promos.includes(row)) promos.push(row);
    return row;
  });
  const ridesRepo = { count: jest.fn().mockResolvedValue(completedRides) };
  // `recordRedemption` without an explicit transaction uses the repo manager.
  const managerMock = {
    findOne: jest.fn((_cls: unknown, args: { where: Record<string, unknown> }) =>
      Promise.resolve(matchWhere(promos, args.where)),
    ),
    insert: jest.fn().mockResolvedValue({}),
    increment: jest.fn().mockResolvedValue({ affected: 1 }),
    // SEC-9: issuedCount (in-flight rides) runs through the manager too.
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(() => counterQb()),
  };
  const promoRepo = {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(matchWhere(promos, where)),
    ),
    find: jest.fn(() => Promise.resolve([...promos])),
    create: jest.fn((data: Partial<PromoRow>) => promoRow(data)),
    save: saveMock,
    delete: jest.fn(({ id }: { id: string }) => {
      const idx = promos.findIndex((p) => p.id === id);
      if (idx < 0) return Promise.resolve({ affected: 0 });
      promos.splice(idx, 1);
      return Promise.resolve({ affected: 1 });
    }),
    increment: jest.fn().mockResolvedValue({ affected: 1 }),
    manager: managerMock as unknown as EntityManager,
  };
  const service = new PromosService(
    ridesRepo as unknown as Repository<RideEntity>,
    promoRepo as unknown as Repository<PromoEntity>,
  );
  return { service, promoRepo, ridesRepo, saveMock, managerMock };
}

const dto = (overrides: Partial<PromoAdminDto> = {}): PromoAdminDto => ({
  code: 'SUMMER10',
  discountAmount: 10,
  ...overrides,
});

describe('PromosService (Task 8 / PR-1 — DB-backed promos)', () => {
  const past = new Date(Date.now() - 86_400_000);
  const future = new Date(Date.now() + 86_400_000);

  describe('discountFor', () => {
    it('returns the amount for a known code, normalising case + whitespace', async () => {
      const { service } = buildService([promoRow({ code: 'VAZHI20' })]);
      expect(await service.discountFor(' vazhi20 ')).toBe(20);
    });

    it('returns 0 for an unknown code (deleted promo)', async () => {
      const { service } = buildService([]);
      expect(await service.discountFor('GONE')).toBe(0);
    });

    it('honours the code even when the promo has since been deactivated', async () => {
      const { service } = buildService([promoRow({ active: false })]);
      expect(await service.discountFor('VAZHI20')).toBe(20);
    });
  });

  describe('resolveDiscount', () => {
    it('rejects unknown codes', async () => {
      const { service } = buildService([]);
      await expect(service.resolveDiscount('NOPE', 'r1')).rejects.toThrow(
        'Promo code "NOPE" is not valid.',
      );
    });

    it('rejects inactive promos', async () => {
      const { service } = buildService([promoRow({ active: false })]);
      await expect(service.resolveDiscount('VAZHI20', 'r1')).rejects.toThrow(
        'Promo code "VAZHI20" is no longer active.',
      );
    });

    it('rejects promos outside their validity window', async () => {
      const { service } = buildService([promoRow({ validFrom: future })]);
      await expect(service.resolveDiscount('VAZHI20', 'r1')).rejects.toThrow(
        'is not active yet.',
      );

      const { service: service2 } = buildService([promoRow({ validTo: past })]);
      await expect(service2.resolveDiscount('VAZHI20', 'r1')).rejects.toThrow('has expired.');
    });

    it('rejects when the redemption cap is reached', async () => {
      const { service } = buildService([
        promoRow({ maxRedemptions: 3, redemptionCount: 3 }),
      ]);
      await expect(service.resolveDiscount('VAZHI20', 'r1')).rejects.toThrow(
        'has reached its redemption limit.',
      );
    });

    it('counts in-flight rides toward the cap (SEC-9: issued = completed + in flight)', async () => {
      const { service, managerMock } = buildService([
        promoRow({ maxRedemptions: 3, redemptionCount: 2 }),
      ]);
      managerMock.count.mockResolvedValue(1); // one ride is still running the code

      await expect(service.resolveDiscount('VAZHI20', 'r1')).rejects.toThrow(
        'has reached its redemption limit.',
      );
      expect(managerMock.count).toHaveBeenCalledWith(
        RideEntity,
        expect.objectContaining({
          where: expect.objectContaining({ promoCode: 'VAZHI20' }),
        }),
      );
    });

    it('rejects first-ride promos once the rider has completed a ride', async () => {
      const { service, ridesRepo } = buildService([promoRow({ firstRideOnly: true })], 1);
      await expect(service.resolveDiscount('VAZHI20', 'r1')).rejects.toThrow(
        'is only valid for your first ride.',
      );
      expect(ridesRepo.count).toHaveBeenCalledWith({
        where: { riderId: 'r1', status: 'completed' },
      });
    });

    it('returns the amount for an eligible rider', async () => {
      const { service } = buildService([promoRow({ firstRideOnly: true })], 0);
      expect(await service.resolveDiscount('VAZHI20', 'r1')).toBe(20);
    });
  });

  describe('assertBookable (SEC-9 — authoritative booking gate)', () => {
    // Emulates the booking transaction's manager: findOne gets the locked
    // promo, count answers issuedCount (in-flight) vs firstRide (completed).
    const bookingEm = (promo: PromoRow | null, inFlight = 0, completed = 0) => ({
      findOne: jest.fn().mockResolvedValue(promo),
      count: jest
        .fn()
        .mockImplementation((_cls: unknown, opts: { where?: { riderId?: string } }) =>
          Promise.resolve(opts?.where?.riderId ? completed : inFlight),
        ),
    });

    it('locks the promo row FOR UPDATE and returns the discount', async () => {
      const { service } = buildService([]);
      const em = bookingEm(promoRow({ discountAmount: 20 }));

      expect(
        await service.assertBookable(em as unknown as EntityManager, ' vazhi20 ', 'r1'),
      ).toBe(20);

      // The lock is what serializes concurrent bookings of one code.
      expect(em.findOne).toHaveBeenCalledWith(PromoEntity, {
        where: { code: 'VAZHI20' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('rejects when completed + in-flight rides fill the cap', async () => {
      const { service } = buildService([]);
      const em = bookingEm(promoRow({ maxRedemptions: 3, redemptionCount: 2 }), 1);

      await expect(
        service.assertBookable(em as unknown as EntityManager, 'VAZHI20', 'r1'),
      ).rejects.toThrow('has reached its redemption limit.');
      // The in-flight ride was counted — the old counter-only check missed it.
      expect(em.count).toHaveBeenCalledWith(
        RideEntity,
        expect.objectContaining({
          where: expect.objectContaining({ promoCode: 'VAZHI20' }),
        }),
      );
    });

    it('allows booking while the cap still has room', async () => {
      const { service } = buildService([]);
      const em = bookingEm(promoRow({ maxRedemptions: 3, redemptionCount: 1 }), 1);

      expect(
        await service.assertBookable(em as unknown as EntityManager, 'VAZHI20', 'r1'),
      ).toBe(20);
    });

    it('keeps the rider-facing messages identical to resolveDiscount', async () => {
      const { service } = buildService([]);

      const missing = bookingEm(null);
      await expect(
        service.assertBookable(missing as unknown as EntityManager, 'NOPE', 'r1'),
      ).rejects.toThrow('Promo code "NOPE" is not valid.');

      const inactive = bookingEm(promoRow({ active: false }));
      await expect(
        service.assertBookable(inactive as unknown as EntityManager, 'VAZHI20', 'r1'),
      ).rejects.toThrow('Promo code "VAZHI20" is no longer active.');
    });

    it('rejects first-ride promos for riders who already completed a trip', async () => {
      const { service } = buildService([]);
      const em = bookingEm(promoRow({ firstRideOnly: true }), 0, 2);

      await expect(
        service.assertBookable(em as unknown as EntityManager, 'VAZHI20', 'r1'),
      ).rejects.toThrow('is only valid for your first ride.');
    });
  });

  describe('getActivePromos', () => {
    it('returns only redeemable + eligible promos as rider cards', async () => {
      const { service } = buildService(
        [
          promoRow({ id: 'live' }),
          promoRow({ id: 'off', active: false }),
          promoRow({ id: 'expired', validTo: past }),
          promoRow({ id: 'scheduled', validFrom: future }),
          promoRow({ id: 'capped', maxRedemptions: 1, redemptionCount: 1 }),
        ],
        0,
      );
      const cards = await service.getActivePromos('r1');
      expect(cards.map((c) => c.code)).toEqual(['VAZHI20']);
    });

    it('hides first-ride promos from riders with completed rides', async () => {
      const { service } = buildService([promoRow({ firstRideOnly: true })], 2);
      expect(await service.getActivePromos('r1')).toEqual([]);
    });

    it('composes default copy when the admin left the fields empty', async () => {
      const { service } = buildService([promoRow({ title: null, subtitle: null, cta: null })]);
      const [card] = await service.getActivePromos('r1');
      expect(card).toEqual({
        code: 'VAZHI20',
        title: 'Rs 20 off your ride',
        subtitle: 'Tap to apply code VAZHI20',
        cta: 'Apply',
        discountAmount: 20,
        firstRideOnly: false,
      } satisfies PromoCard);
    });
  });

  describe('validate', () => {
    it('wraps success and failure into the rider-facing result', async () => {
      const { service } = buildService([promoRow()]);
      expect(await service.validate('VAZHI20', 'r1')).toEqual({
        valid: true,
        discountAmount: 20,
        message: 'Code applied! You save Rs 20.',
      });

      const { service: empty } = buildService([]);
      const res = await empty.validate('GONE', 'r1');
      expect(res.valid).toBe(false);
      expect(res.discountAmount).toBe(0);
      expect(res.message).toContain('not valid');
    });
  });

  describe('recordRedemption', () => {
    it('inserts the redemption and bumps the cap counter in the same manager', async () => {
      const rows = [promoRow({ discountAmount: 20 })];
      const { service, promoRepo } = buildService(rows);
      const qb = counterQb();
      const manager = {
        findOne: jest.fn().mockResolvedValue(rows[0]),
        insert: jest.fn().mockResolvedValue({}),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      } as unknown as EntityManager;

      await service.recordRedemption(' vaZHi20 ', 'ride-1', 'rider-1', manager);

      expect(manager.findOne).toHaveBeenCalledWith(PromoEntity, {
        where: { code: 'VAZHI20' },
      });
      expect(manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          promoId: 'p1',
          code: 'VAZHI20',
          rideId: 'ride-1',
          riderId: 'rider-1',
          discountAmount: 20,
        }),
      );
      // SEC-9: ONE conditional increment — the counter can never be pushed
      // past the declared cap (affected=0 there is a silent no-op, never an
      // error: a completed ride must not fail over a counter).
      expect(qb.set).toHaveBeenCalledWith({ redemptionCount: expect.any(Function) });
      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining('"redemptionCount" < "maxRedemptions"'),
        { id: 'p1' },
      );
      expect(qb.execute).toHaveBeenCalled();
      expect(promoRepo.increment).not.toHaveBeenCalled(); // never an uncapped bump
    });

    it('is a no-op when the promo was deleted since booking', async () => {
      const { service, promoRepo } = buildService([]);
      await expect(
        service.recordRedemption('GONE', 'ride-1', 'rider-1'),
      ).resolves.toBeUndefined();
      expect(promoRepo.increment).not.toHaveBeenCalled();
    });

    it('falls back to the repo manager when no transaction is passed', async () => {
      const { service, managerMock } = buildService([promoRow({ code: 'WALKIN5' })]);

      await service.recordRedemption('walkin5', 'ride-2', 'rider-2');

      expect(managerMock.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: 'WALKIN5', rideId: 'ride-2' }),
      );
      const qb = managerMock.createQueryBuilder.mock.results[0].value as ReturnType<
        typeof counterQb
      >;
      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining('"redemptionCount" < "maxRedemptions"'),
        { id: 'p1' },
      );
      expect(qb.execute).toHaveBeenCalled();
    });

    it('does NOT record a redemption when the cap was reached before completion', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const rows = [promoRow({ maxRedemptions: 5, redemptionCount: 5 })];
        const { service } = buildService(rows);
        const qb = counterQb();
        qb.execute.mockResolvedValue({ affected: 0 }); // conditional increment lost the race
        const manager = {
          findOne: jest.fn().mockResolvedValue(rows[0]),
          insert: jest.fn().mockResolvedValue({}),
          createQueryBuilder: jest.fn().mockReturnValue(qb),
        } as unknown as EntityManager;

        // The ride still completes at the already-quoted fare — never a throw.
        await expect(
          service.recordRedemption(' VAZHI20 ', 'ride-9', 'rider-9', manager),
        ).resolves.toBeUndefined();

        expect(manager.insert).not.toHaveBeenCalled(); // nothing recorded
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hit its redemption cap'));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('never lets two completing rides push the counter past the cap', async () => {
      // Both rides passed the booking-time check (1 redemption left). On
      // completion exactly ONE conditional increment may win; the loser
      // records nothing — the count cannot exceed the cap.
      const rows = [promoRow({ maxRedemptions: 2, redemptionCount: 1 })];
      const { service } = buildService(rows);
      const results = [{ affected: 1 }, { affected: 0 }];
      const qb = counterQb();
      qb.execute.mockImplementation(() => Promise.resolve(results.shift() ?? { affected: 0 }));
      const insert = jest.fn().mockResolvedValue({});
      const manager = {
        findOne: jest.fn().mockResolvedValue(rows[0]),
        insert,
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      } as unknown as EntityManager;

      await service.recordRedemption('VAZHI20', 'ride-a', 'rider-a', manager);
      await service.recordRedemption('VAZHI20', 'ride-b', 'rider-b', manager);

      expect(qb.execute).toHaveBeenCalledTimes(2);
      expect(insert).toHaveBeenCalledTimes(1); // only the winner records its ride
    });
  });

  describe('promo cap invariant across booking + completion (Task 10)', () => {
    it('completed + in-flight redemptions never exceed the cap', async () => {
      const promo = promoRow({ maxRedemptions: 2, redemptionCount: 0 });
      const { service } = buildService([promo], 0);

      // One fake transaction manager shared by booking and completion;
      // issued = completed redemptions + in-flight rides, live.
      let inFlight = 0;
      let completed = 0;
      const qb = counterQb(); // conditional increment (affected:1 while room remains)
      const em = {
        findOne: jest.fn().mockResolvedValue(promo),
        count: jest
          .fn()
          .mockImplementation((_cls: unknown, opts: { where?: { riderId?: string } }) =>
            Promise.resolve(opts?.where?.riderId ? completed : inFlight),
          ),
        insert: jest.fn().mockResolvedValue({}),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      } as unknown as EntityManager;

      // A and B book while there is room (issued 0, then 1 — always < 2)...
      await service.assertBookable(em, 'VAZHI20', 'rider-a');
      inFlight++;
      await service.assertBookable(em, 'VAZHI20', 'rider-b');
      inFlight++;

      // ...C is refused: completed (0) + in-flight (2) fill the cap.
      await expect(service.assertBookable(em, 'VAZHI20', 'rider-c')).rejects.toThrow(
        'has reached its redemption limit.',
      );

      // A completes: the conditional increment wins, the ride leaves the
      // in-flight set. B completes the same way — still under the cap.
      inFlight--;
      await service.recordRedemption('VAZHI20', 'ride-a', 'rider-a', em);
      completed++;
      inFlight--;
      await service.recordRedemption('VAZHI20', 'ride-b', 'rider-b', em);
      completed++;

      // Exactly two increments for cap=2, and the invariant held throughout.
      expect(qb.execute).toHaveBeenCalledTimes(2);
      expect(completed + inFlight).toBeLessThanOrEqual(promo.maxRedemptions ?? 2);
      expect(completed).toBe(2);
    });
  });

  describe('admin CRUD', () => {
    it('createPromo normalises the code and applies defaults', async () => {
      const rows: PromoRow[] = [];
      const { service, promoRepo } = buildService(rows);

      const created = await service.createPromo(
        dto({ code: '  summer10 ', validFrom: '2026-01-01T00:00:00.000Z' }),
      );

      expect(created.code).toBe('SUMMER10');
      expect(created.active).toBe(true);
      expect(created.firstRideOnly).toBe(false);
      expect(created.validFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(created.maxRedemptions).toBeNull();
      expect(promoRepo.findOne).toHaveBeenCalledWith({ where: { code: 'SUMMER10' } });
      expect(rows).toHaveLength(1);
    });

    it('createPromo rejects duplicate codes with 409', async () => {
      const { service } = buildService([promoRow({ code: 'SUMMER10' })]);
      await expect(service.createPromo(dto())).rejects.toThrow(ConflictException);
    });

    it('createPromo rejects an inverted validity window', async () => {
      const { service } = buildService([]);
      await expect(
        service.createPromo(
          dto({ validFrom: future.toISOString(), validTo: past.toISOString() }),
        ),
      ).rejects.toThrow('validFrom must be before validTo');
    });

    it('maps a unique-violation race on save to 409', async () => {
      const { service, saveMock } = buildService([]);
      saveMock.mockRejectedValueOnce({ code: '23505' });
      await expect(service.createPromo(dto())).rejects.toThrow(ConflictException);
    });

    it('updatePromo merges only the provided fields and null clears the window', async () => {
      const rows = [
        promoRow({ validFrom: past, validTo: future, title: 'Old title', redemptionCount: 4 }),
      ];
      const { service } = buildService(rows);

      const updated = await service.updatePromo('p1', dto({ validFrom: null, active: false }));

      expect(updated.code).toBe('SUMMER10'); // code + discount always sent by the form
      expect(updated.validFrom).toBeNull(); // null clears
      expect(updated.validTo).toEqual(future); // untouched
      expect(updated.title).toBe('Old title'); // untouched
      expect(updated.active).toBe(false);
      expect(updated.redemptionCount).toBe(4); // never client-writable
    });

    it('updatePromo rejects renaming onto an existing code and unknown ids', async () => {
      const { service } = buildService([
        promoRow({ id: 'p1', code: 'AAA111' }),
        promoRow({ id: 'p2', code: 'BBB222' }),
      ]);
      await expect(
        service.updatePromo('p1', dto({ code: 'BBB222' })),
      ).rejects.toThrow(ConflictException);
      await expect(service.updatePromo('missing', dto())).rejects.toThrow(NotFoundException);
    });

    it('removePromo deletes the row and 404s unknown ids', async () => {
      const rows = [promoRow()];
      const { service, promoRepo } = buildService(rows);

      expect(await service.removePromo('p1')).toEqual({ id: 'p1' });
      expect(rows).toHaveLength(0);
      await expect(service.removePromo('p1')).rejects.toThrow(NotFoundException);
      expect(promoRepo.delete).toHaveBeenCalledWith({ id: 'p1' });
    });

    it('listAdmin returns every promo newest first', async () => {
      const { service, promoRepo } = buildService([promoRow()]);
      await service.listAdmin();
      expect(promoRepo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });
  });
});
