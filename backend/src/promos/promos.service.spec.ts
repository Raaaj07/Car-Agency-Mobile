import { ConflictException, NotFoundException } from '@nestjs/common';
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
      const manager = {
        findOne: jest.fn().mockResolvedValue(rows[0]),
        insert: jest.fn().mockResolvedValue({}),
        increment: jest.fn().mockResolvedValue({ affected: 1 }),
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
      expect(manager.increment).toHaveBeenCalledWith(PromoEntity, { id: 'p1' }, 'redemptionCount', 1);
      expect(promoRepo.increment).not.toHaveBeenCalled(); // manager path only
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
      expect(managerMock.increment).toHaveBeenCalledWith(
        PromoEntity,
        { id: 'p1' },
        'redemptionCount',
        1,
      );
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
