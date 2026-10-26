import { Controller, Get, Inject, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../config/redis.module';
import { Public } from './decorators/public.decorator';

/**
 * Pass-4 (task 9): a deliberately dumb liveness/readiness probe for the
 * platform / load balancer. It answers ONLY `{ status }` — no version, host
 * or error text (nothing for an attacker to fingerprint) — and turns
 * `degraded` (503) the moment either dependency fails a trivial round-trip.
 *
 * The reply is written directly (injected @Res), bypassing the global
 * exception filter so the body keeps exactly this minimal shape.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  async check(@Res() res: Response): Promise<void> {
    // Task 18: Bounded timeouts (2000ms) ensure health check never hangs
    const dbCheck = Promise.race([
      this.dataSource.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Postgres query timeout')), 2000)),
    ]);
    const redisCheck = Promise.race([
      this.redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 2000)),
    ]);

    const [db, cache] = await Promise.allSettled([dbCheck, redisCheck]);
    const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      postgres: db.status === 'fulfilled' ? 'up' : 'down',
      redis: cache.status === 'fulfilled' ? 'up' : 'down',
    });
  }
}
