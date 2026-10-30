import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export type RedisConnectionConfig = {
  url?: string;
  options: RedisOptions;
};

/**
 * The sole Redis connection policy for application commands and Socket.IO.
 * A URL carries its own TLS scheme and database path; never layer REDIS_TLS
 * on top of it. The host/port fallback retains the explicit TLS switch.
 */
export function redisConnectionConfig(config: ConfigService): RedisConnectionConfig {
  const url = config.get<string>('REDIS_URL')?.trim() || undefined;
  const common: RedisOptions = {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 4_000,
    enableReadyCheck: true,
    // Do not accumulate commands while a managed Redis endpoint reconnects.
    // Callers either handle the immediate failure or retry on their next tick.
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  };
  if (url) return { url, options: common };

  const useTls = (config.get<string>('REDIS_TLS') ?? 'false') === 'true';
  const db = Number(config.get<string>('REDIS_DB') ?? 0);
  return {
    options: {
      ...common,
      host: config.get<string>('REDIS_HOST'),
      port: Number(config.get<string>('REDIS_PORT') ?? 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number.isInteger(db) && db >= 0 ? db : 0,
      ...(useTls ? { tls: {} } : {}),
    },
  };
}

/**
 * D-3: quit the shared client on app shutdown so connections don't leak
 * (dev reloads, tests, rolling deploys). quit() is graceful; disconnect() is
 * the fallback when the server already went away.
 */
@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisLifecycle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn(`Redis quit failed, forcing disconnect: ${(err as Error).message}`);
      this.client.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const connection = redisConnectionConfig(config);
        const client = connection.url ? new Redis(connection.url, connection.options) : new Redis(connection.options);
        // Prevent "[ioredis] Unhandled error event" spam from crashing logs.
        client.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[redis] ${err.message}`);
        });
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
