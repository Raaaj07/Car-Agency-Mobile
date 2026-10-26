import { Inject, Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.module';

/** Rate-limit keys live under `throttle:` (hits + a separate block key). */
export const THROTTLE_KEY_PREFIX = 'throttle';

/**
 * The record shape ThrottlerGuard reads (`@nestjs/throttler` does not
 * re-export ThrottlerStorageRecord from the package root, so we spell the
 * four fields out structurally — same contract, no deep import).
 */
export interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Pass-4 (task 8): rate-limit counters that survive restarts and are shared
 * by every backend instance. The stock ThrottlerStorageService lives in
 * process memory, so every replica (and every restart) handed out a fresh
 * 300/min budget per client — a multiplies the limit by the instance count.
 *
 * Semantics mirror @nestjs/throttler's own storage: one INCR per hit with a
 * PEXPIRE on the first touch, a separate block key honouring blockDuration,
 * and the record the guard reads (`isBlocked` → 429).
 *
 * Fails OPEN: when Redis is unreachable every request is allowed —
 * availability over strictness (the per-OTP / per-ride checks below the
 * limiter still hold) — with at most one warning per minute so an outage
 * cannot drown the logs.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastFailOpenWarnAt = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    try {
      const hitsKey = `${THROTTLE_KEY_PREFIX}:${throttlerName}:${key}`;
      const blockKey = `${THROTTLE_KEY_PREFIX}:block:${throttlerName}:${key}`;

      // A still-blocked bucket keeps blocking without counting further hits.
      const blockTtl = await this.redis.pttl(blockKey);
      if (blockTtl > 0) {
        const hitsTtl = await this.redis.pttl(hitsKey);
        return {
          totalHits: limit + 1,
          timeToExpire: hitsTtl > 0 ? Math.ceil(hitsTtl / 1000) : Math.ceil(ttl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockTtl / 1000),
        };
      }

      const totalHits = await this.redis.incr(hitsKey);
      if (totalHits === 1) {
        await this.redis.pexpire(hitsKey, ttl);
      }
      const hitsTtl = await this.redis.pttl(hitsKey);
      const timeToExpire = hitsTtl > 0 ? Math.ceil(hitsTtl / 1000) : Math.ceil(ttl / 1000);

      if (totalHits > limit) {
        if (blockDuration > 0) {
          await this.redis.psetex(blockKey, blockDuration, '1');
        }
        return {
          totalHits,
          timeToExpire,
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockDuration / 1000),
        };
      }
      return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
    } catch (err) {
      this.warnFailOpen(err);
      // totalHits 1 <= any sane limit → the guard lets the request through.
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  private warnFailOpen(err: unknown): void {
    const now = Date.now();
    if (now - this.lastFailOpenWarnAt < 60_000) return;
    this.lastFailOpenWarnAt = now;
    this.logger.warn(
      `throttler storage unreachable — rate limiting FAILS OPEN: ${(err as Error).message}`,
    );
  }
}
