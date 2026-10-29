import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshSessionEntity } from './entities/refresh-session.entity';

/** How long a dead (revoked/expired) refresh session is kept before deletion. */
export const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** First run is delayed so boot/e2e tests are not competing with a bulk DELETE. */
const INITIAL_DELAY_MS = 5 * 60 * 1000;

/**
 * Lifecycle: refresh_sessions gained per-device rows (rotation, replay
 * detection), but only cleaned itself up for the user who happened to log in
 * again. A deployment with steady signups but no repeat logins would grow the
 * table forever.
 *
 * This runs one idempotent DELETE per day (and once after boot) removing rows
 * that expired or were revoked more than SESSION_RETENTION_MS ago. Running it
 * on every instance is harmless — DELETE is idempotent and the table is
 * indexed on expiresAt/revokedAt.
 */
@Injectable()
export class SessionsCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SessionsCleanupService.name);
  private interval?: NodeJS.Timeout;
  private initial?: NodeJS.Timeout;

  constructor(
    @InjectRepository(RefreshSessionEntity)
    private readonly sessions: Repository<RefreshSessionEntity>,
  ) {}

  onApplicationBootstrap(): void {
    this.initial = setTimeout(() => void this.purge(), INITIAL_DELAY_MS);
    this.interval = setInterval(() => void this.purge(), DAY_MS);
    // Never keep the process alive just for housekeeping.
    this.initial.unref?.();
    this.interval.unref?.();
  }

  onModuleDestroy(): void {
    if (this.initial) clearTimeout(this.initial);
    if (this.interval) clearInterval(this.interval);
  }

  /** Deletes dead sessions past retention; returns the number of rows removed. */
  async purge(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - SESSION_RETENTION_MS);
    try {
      const result = await this.sessions
        .createQueryBuilder()
        .delete()
        .where('"revokedAt" < :cutoff OR "expiresAt" < :cutoff', { cutoff })
        .execute();
      const removed = result.affected ?? 0;
      if (removed > 0) {
        this.logger.log(`Purged ${removed} dead refresh session(s) older than ${SESSION_RETENTION_MS / DAY_MS} days`);
      }
      return removed;
    } catch (err) {
      // Housekeeping must never crash the app.
      this.logger.warn(`Refresh-session purge failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
