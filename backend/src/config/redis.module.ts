import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const useTls = (config.get<string>('REDIS_TLS') ?? 'false') === 'true';
        const client = new Redis({
          host: config.get<string>('REDIS_HOST'),
          port: Number(config.get<string>('REDIS_PORT') ?? 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          retryStrategy: (times) => Math.min(times * 200, 5000),
          // Only enable TLS when the server actually expects it.
          // If you see "wrong version number", the server is plaintext —
          // set REDIS_TLS=false in .env.
          ...(useTls ? { tls: {} } : {}),
        });
        // Prevent "[ioredis] Unhandled error event" spam from crashing logs.
        client.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[redis] ${err.message}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
