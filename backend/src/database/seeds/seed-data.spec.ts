import { Repository } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import {
  PHONE_PREFIX,
  adminPhonesFromEnv,
  ensureAdminUsers,
  phoneForIndex,
  planDriver,
} from './seed-data';

/**
 * Task 7 seed hygiene:
 *  - deterministic plans (same index => same driver, independent of order)
 *  - idempotent admin backfill from ADMIN_PHONES (create / promote / no-op)
 */
describe('seed-data (Task 7: deterministic, idempotent seed)', () => {
  const opts = { centerLat: 11.6643, centerLng: 78.146, spreadKm: 6 };

  describe('planDriver', () => {
    it('is deterministic: the same index always yields the same plan', () => {
      expect(planDriver(7, opts)).toEqual(planDriver(7, opts));
    });

    it('is order-independent: later drivers do not shift when earlier ones are skipped', () => {
      // A partial run "skips" index 0..4 by never computing them — the plan
      // for #5 must still be identical to a full run's plan for #5.
      const isolated = planDriver(5, opts);
      for (let i = 0; i < 4; i++) planDriver(i, opts);
      expect(planDriver(5, opts)).toEqual(isolated);
    });

    it('keeps phones in the deterministic block and unique per index', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const phone = phoneForIndex(i);
        expect(phone).toMatch(new RegExp(`^${PHONE_PREFIX}\\d{5}$`));
        expect(seen.has(phone)).toBe(false);
        seen.add(phone);
        expect(planDriver(i, opts).phone).toBe(phone);
      }
      expect(seen.size).toBe(50);
    });

    it('places every driver near the configured city center', () => {
      for (let i = 0; i < 20; i++) {
        const plan = planDriver(i, opts);
        expect(Math.abs(plan.lat - opts.centerLat)).toBeLessThanOrEqual(opts.spreadKm / 111 + 1e-9);
        expect(Math.abs(plan.lng - opts.centerLng)).toBeLessThanOrEqual(
          opts.spreadKm / (111 * Math.cos((opts.centerLat * Math.PI) / 180)) + 1e-9,
        );
        expect(plan.vehicleType).toMatch(/^(auto|mini|sedan|suv)$/);
        const rating = Number(plan.rating);
        expect(rating).toBeGreaterThanOrEqual(4);
        expect(rating).toBeLessThanOrEqual(5); // (4 + rng()).toFixed(2) rounds 4.995+ to "5.00"
        expect(plan.totalTrips).toBeGreaterThanOrEqual(0);
        expect(plan.totalTrips).toBeLessThan(400);
      }
    });

    it('keeps ~80% of drivers online (i % 5 !== 0)', () => {
      const online = Array.from({ length: 50 }, (_, i) => planDriver(i, opts).isOnline);
      expect(online.filter(Boolean).length).toBe(40);
    });
  });

  describe('adminPhonesFromEnv', () => {
    it('normalises to trailing 10 digits, dropping junk entries', () => {
      expect(adminPhonesFromEnv('+91 98765 43210, 07890123456, , not-a-phone')).toEqual([
        '9876543210',
        '7890123456',
      ]);
    });

    it('returns an empty list when ADMIN_PHONES is unset', () => {
      expect(adminPhonesFromEnv('')).toEqual([]);
      const prev = process.env.ADMIN_PHONES;
      delete process.env.ADMIN_PHONES;
      try {
        expect(adminPhonesFromEnv(undefined as unknown as string)).toEqual([]); // falls back to env
      } finally {
        if (prev !== undefined) process.env.ADMIN_PHONES = prev;
      }
    });
  });

  describe('ensureAdminUsers', () => {
    let repo: {
      findOne: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };
    let users: Array<{ id: string; phone: string; role: string }>;

    const buildRepo = () => {
      users = [];
      repo = {
        findOne: jest.fn(({ where }: { where: { phone: string } }) =>
          Promise.resolve(users.find((u) => u.phone === where.phone) ?? null),
        ),
        create: jest.fn((data: Record<string, unknown>) => data as { id: string; phone: string; role: string }),
        save: jest.fn((row: { id?: string } & Record<string, unknown>) => {
          if (!row.id) {
            row.id = `u${users.length + 1}`;
            users.push(row as { id: string; phone: string; role: string });
          } else {
            const idx = users.findIndex((u) => u.id === row.id);
            if (idx >= 0) users[idx] = row as { id: string; phone: string; role: string };
          }
          return Promise.resolve(row);
        }),
      };
      return repo as unknown as Repository<UserEntity>;
    };

    it('creates missing accounts with role admin', async () => {
      const repoEntity = buildRepo();

      const changed = await ensureAdminUsers(repoEntity, ['9876543210']);

      expect(changed).toBe(1);
      expect(users).toEqual([
        expect.objectContaining({ phone: '9876543210', role: 'admin', isActive: true }),
      ]);
    });

    it('promotes an existing non-admin row', async () => {
      const repoEntity = buildRepo();
      users.push({ id: 'u9', phone: '9876543210', role: 'rider' });

      const changed = await ensureAdminUsers(repoEntity, ['9876543210']);

      expect(changed).toBe(1);
      expect(users[0]).toEqual({ id: 'u9', phone: '9876543210', role: 'admin' });
    });

    it('leaves existing admins untouched (idempotent re-run)', async () => {
      const repoEntity = buildRepo();
      users.push({ id: 'u9', phone: '9876543210', role: 'admin' });

      const changed = await ensureAdminUsers(repoEntity, ['9876543210']);

      expect(changed).toBe(0);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('mixed list: only the rows that need work are changed', async () => {
      const repoEntity = buildRepo();
      users.push({ id: 'u1', phone: '1111111111', role: 'admin' });
      users.push({ id: 'u2', phone: '2222222222', role: 'driver' });

      const changed = await ensureAdminUsers(repoEntity, ['1111111111', '2222222222', '3333333333']);

      expect(changed).toBe(2); // promote driver + create the missing one
      expect(users.find((u) => u.phone === '1111111111')?.role).toBe('admin');
      expect(users.find((u) => u.phone === '2222222222')?.role).toBe('admin');
      expect(users.find((u) => u.phone === '3333333333')?.role).toBe('admin');
    });
  });
});
