import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { FakeRedis } from '../../test/fake-redis';
import { RedisThrottlerStorage, THROTTLE_KEY_PREFIX } from './redis-throttler.storage';

/**
 * Pass-4 (task 8): rate-limit counters live in REDIS, so two backend
 * instances (modelled here as two storage objects over one fake client)
 * share one budget per tracker, and blocks are visible to all of them.
 */
describe('RedisThrottlerStorage', () => {
  const TTL = 60_000;
  const LIMIT = 3;
  const BLOCK = 60_000;

  it('shares one counter across two storage instances (two backend replicas)', async () => {
    const fake = new FakeRedis();
    const replicaA = new RedisThrottlerStorage(fake as unknown as Redis);
    const replicaB = new RedisThrottlerStorage(fake as unknown as Redis);
    const key = 'ip:1.2.3.4';

    // Three hits fit in the budget whichever replica answers them.
    const first = await replicaA.increment(key, TTL, LIMIT, BLOCK, 'default');
    const second = await replicaB.increment(key, TTL, LIMIT, BLOCK, 'default');
    const third = await replicaA.increment(key, TTL, LIMIT, BLOCK, 'default');
    expect([first, second, third].map((r) => r.totalHits)).toEqual([1, 2, 3]);
    expect([first, second, third].some((r) => r.isBlocked)).toBe(false);

    // The 4th hit exceeds the shared limit — blocked on EITHER replica.
    const blockedA = await replicaA.increment(key, TTL, LIMIT, BLOCK, 'default');
    expect(blockedA.isBlocked).toBe(true);
    expect(blockedA.timeToBlockExpire).toBe(60);
    const blockedB = await replicaB.increment(key, TTL, LIMIT, BLOCK, 'default');
    expect(blockedB.isBlocked).toBe(true);

    // A different tracker keeps its own budget.
    const other = await replicaB.increment('ip:5.6.7.8', TTL, LIMIT, BLOCK, 'default');
    expect(other.isBlocked).toBe(false);
    expect(other.totalHits).toBe(1);
  });

  it('keys live under the throttle: prefix and carry the window TTL', async () => {
    const fake = new FakeRedis();
    const storage = new RedisThrottlerStorage(fake as unknown as Redis);

    const record = await storage.increment('user:u-1', TTL, LIMIT, BLOCK, 'default');

    expect(record.timeToExpire).toBe(60);
    expect(await fake.get(`${THROTTLE_KEY_PREFIX}:default:user:u-1`)).toBe('1');
    expect(await fake.pttl(`${THROTTLE_KEY_PREFIX}:default:user:u-1`)).toBe(TTL);
  });

  it('fails OPEN when Redis is unreachable and warns at most once per minute', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const down = {
        pttl: jest.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as Redis;
      const storage = new RedisThrottlerStorage(down);

      const first = await storage.increment('ip:1.1.1.1', TTL, LIMIT, BLOCK, 'default');
      expect(first).toEqual({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      });

      const second = await storage.increment('ip:1.1.1.1', TTL, LIMIT, BLOCK, 'default');
      expect(second.isBlocked).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1); // the second failure is inside the 1 min window
      expect(warnSpy.mock.calls[0][0]).toContain('FAILS OPEN');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
