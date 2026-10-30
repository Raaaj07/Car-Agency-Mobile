import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { FakeRedis } from '../test/fake-redis';
import { DriverEntity } from './entities/driver.entity';
import { GeoService } from './geo.service';

/**
 * D-3 (Task 6): driver last-seen heartbeat.
 *  - every location upsert scores `driver:lastseen` (90 s staleness window)
 *  - the 30 s sweep drops stale (>90 s) drivers from the geo-sets AND forces
 *    them offline in Postgres (isOnline/isAvailable = false)
 *  - going offline cleanly removes the member, so the sweep never touches
 *    Postgres for drivers who already left
 */
type GeoInternals = {
  sweepStaleDrivers(): Promise<void>;
};

describe('GeoService driver last-seen sweep (D-3)', () => {
  const staleCutoffTest = () => Date.now() - 91_000;
  let fake: FakeRedis;
  let repo: { update: jest.Mock };
  let geo: GeoService;
  let internals: GeoInternals;

  beforeEach(() => {
    fake = new FakeRedis();
    repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    geo = new GeoService(
      fake as unknown as Redis,
      repo as unknown as Repository<DriverEntity>,
      // These D-3 tests pin the strict 90 s window; the default (15 min) is
      // covered by the presence-grace tests at the end of this file.
      { get: jest.fn().mockReturnValue(90) } as unknown as ConfigService,
    );
    internals = geo as unknown as GeoInternals;
  });

  it('records a fresh last-seen score, geo position and 90s meta TTL on upsert', async () => {
    await geo.upsertDriverLocation('drv-1', 'sedan', 12.9, 77.6);

    const score = await fake.zscore('driver:lastseen', 'drv-1');
    expect(score).not.toBeNull();
    expect(Date.now() - score!).toBeLessThan(5_000); // just now
    expect(await fake.geopos('drivers:geo:all', 'drv-1')).toEqual({ lng: 77.6, lat: 12.9 });
    expect(await fake.geopos('drivers:geo:sedan', 'drv-1')).toEqual({ lng: 77.6, lat: 12.9 });
    expect(await fake.hget('drivers:meta:drv-1', 'vehicleType')).toBe('sedan');
    expect(await fake.ttl('drivers:meta:drv-1')).toBe(90); // DRIVER_FRESH_MS in seconds
  });

  it('sweep (>90s stale): drops the ghost from Redis AND forces it offline in Postgres', async () => {
    await geo.upsertDriverLocation('drv-ghost', 'sedan', 12.9, 77.6);
    await geo.upsertDriverLocation('drv-fresh', 'auto', 13.0, 77.5);
    await fake.zadd('driver:lastseen', staleCutoffTest(), 'drv-ghost'); // age it out

    await internals.sweepStaleDrivers();

    // Redis cleanup: geo sets, meta hash and the last-seen member are gone.
    expect(await fake.zscore('driver:lastseen', 'drv-ghost')).toBeNull();
    expect(await fake.geopos('drivers:geo:all', 'drv-ghost')).toBeNull();
    expect(await fake.geopos('drivers:geo:sedan', 'drv-ghost')).toBeNull();
    expect(await fake.hget('drivers:meta:drv-ghost', 'vehicleType')).toBeNull();

    // Postgres offline: conditional updates keyed on the stale ids.
    expect(repo.update).toHaveBeenCalledTimes(2);
    const [firstWhere, firstSet] = repo.update.mock.calls[0];
    expect(firstWhere.id.value).toEqual(['drv-ghost']);
    expect(firstWhere.isOnline).toBe(true);
    expect(firstSet).toEqual({ isOnline: false, isAvailable: false });
    const [secondWhere, secondSet] = repo.update.mock.calls[1];
    expect(secondWhere.id.value).toEqual(['drv-ghost']);
    expect(secondSet).toEqual({ isAvailable: false });

    // The fresh driver is untouched.
    expect(await fake.zscore('driver:lastseen', 'drv-fresh')).not.toBeNull();
    expect(await fake.geopos('drivers:geo:all', 'drv-fresh')).not.toBeNull();
  });

  it('sweep with only fresh drivers does not write to Postgres at all', async () => {
    await geo.upsertDriverLocation('drv-fresh', 'auto', 13.0, 77.5);

    await internals.sweepStaleDrivers();

    expect(repo.update).not.toHaveBeenCalled();
    expect(await fake.zscore('driver:lastseen', 'drv-fresh')).not.toBeNull();
  });

  it('removeDriver clears the member so a cleanly-offlined driver is never swept', async () => {
    await geo.upsertDriverLocation('drv-1', 'sedan', 12.9, 77.6);
    await geo.removeDriver('drv-1', 'sedan');

    expect(await fake.zscore('driver:lastseen', 'drv-1')).toBeNull();

    // Even a later sweep finds nothing stale for this driver.
    await fake.zadd('driver:lastseen', staleCutoffTest(), 'drv-other');
    repo.update.mockClear();
    await internals.sweepStaleDrivers();
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.update.mock.calls[0][0].id.value).toEqual(['drv-other']);
    expect(repo.update.mock.calls[1][0].id.value).toEqual(['drv-other']);
  });

  it('a Postgres failure does not stop the Redis ghost cleanup (best-effort)', async () => {
    await geo.upsertDriverLocation('drv-1', 'sedan', 12.9, 77.6);
    await fake.zadd('driver:lastseen', staleCutoffTest(), 'drv-1');
    repo.update.mockRejectedValue(new Error('db down'));

    await expect(internals.sweepStaleDrivers()).resolves.toBeUndefined();

    // Redis side still cleaned (sweep swallows and logs the DB error).
    expect(await fake.zscore('driver:lastseen', 'drv-1')).toBeNull();
    expect(await fake.geopos('drivers:geo:all', 'drv-1')).toBeNull();
  });

  it('a Redis failure does not reject the sweep (logged, retried next tick)', async () => {
    const failing = {
      zrangebyscore: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as FakeRedis;
    const svc = new GeoService(
      failing as unknown as Redis,
      repo as unknown as Repository<DriverEntity>,
    );

    await expect((svc as unknown as GeoInternals).sweepStaleDrivers()).resolves.toBeUndefined();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('skips an overlapping stale-driver sweep while Redis is still resolving the prior sweep', async () => {
    let release!: (members: string[]) => void;
    const pending = new Promise<string[]>((resolve) => {
      release = resolve;
    });
    const slow = { zrangebyscore: jest.fn().mockReturnValue(pending) } as unknown as Redis;
    const svc = new GeoService(slow, repo as unknown as Repository<DriverEntity>);

    const first = (svc as unknown as GeoInternals).sweepStaleDrivers();
    await Promise.resolve();
    await (svc as unknown as GeoInternals).sweepStaleDrivers();
    expect((slow.zrangebyscore as jest.Mock)).toHaveBeenCalledTimes(1);

    release([]);
    await first;
  });
});

// A parked, resting driver sends no new GPS fix for a while but is still online:
// by default he stays on the map for 15 minutes of silence (DRIVER_PRESENCE_GRACE_SECONDS).
describe('GeoService presence grace window (parked driver)', () => {
  let fake: FakeRedis;
  let repo: { update: jest.Mock };

  const build = (graceSeconds?: number) =>
    new GeoService(
      fake as unknown as Redis,
      repo as unknown as Repository<DriverEntity>,
      { get: jest.fn().mockReturnValue(graceSeconds) } as unknown as ConfigService,
    ) as unknown as GeoInternals & Pick<GeoService, 'upsertDriverLocation'>;

  beforeEach(() => {
    fake = new FakeRedis();
    repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  });

  it('by default (no setting) keeps a driver who was silent for 10 minutes', async () => {
    const geo = build();
    await geo.upsertDriverLocation('drv-parked', 'sedan', 12.9, 77.6);
    await fake.zadd('driver:lastseen', Date.now() - 10 * 60_000, 'drv-parked');

    await geo.sweepStaleDrivers();

    expect(repo.update).not.toHaveBeenCalled();
    expect(await fake.zscore('driver:lastseen', 'drv-parked')).not.toBeNull();
    expect(await fake.geopos('drivers:geo:all', 'drv-parked')).not.toBeNull();
  });

  it('by default removes a driver silent for 16 minutes (a crashed app is not kept forever)', async () => {
    const geo = build();
    await geo.upsertDriverLocation('drv-gone', 'sedan', 12.9, 77.6);
    await fake.zadd('driver:lastseen', Date.now() - 16 * 60_000, 'drv-gone');

    await geo.sweepStaleDrivers();

    expect(await fake.zscore('driver:lastseen', 'drv-gone')).toBeNull();
    expect(await fake.geopos('drivers:geo:all', 'drv-gone')).toBeNull();
    expect(repo.update).toHaveBeenCalledTimes(2); // forced offline in Postgres too
  });

  it('DRIVER_PRESENCE_GRACE_SECONDS changes the window (e.g. 5 minutes)', async () => {
    const geo = build(300);
    await geo.upsertDriverLocation('drv-a', 'auto', 12.9, 77.6);
    await geo.upsertDriverLocation('drv-b', 'auto', 12.9, 77.6);
    await fake.zadd('driver:lastseen', Date.now() - 4 * 60_000, 'drv-a'); // within 5 min
    await fake.zadd('driver:lastseen', Date.now() - 6 * 60_000, 'drv-b'); // past 5 min

    await geo.sweepStaleDrivers();

    expect(await fake.zscore('driver:lastseen', 'drv-a')).not.toBeNull();
    expect(await fake.zscore('driver:lastseen', 'drv-b')).toBeNull();
  });

  it('the meta hash lives as long as the window (default 15 minutes)', async () => {
    await build().upsertDriverLocation('drv-1', 'sedan', 12.9, 77.6);
    expect(await fake.ttl('drivers:meta:drv-1')).toBe(900);
  });
});
