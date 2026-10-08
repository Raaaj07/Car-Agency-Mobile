import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation';
import { RedisModule } from './config/redis.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { PlacesModule } from './places/places.module';
import { PromosModule } from './promos/promos.module';

// console.log('DB CONFIG:', {
//   host: process.env.DB_HOST,
//   port: process.env.DB_PORT,
//   username: process.env.DB_USERNAME,
//   database: process.env.DB_DATABASE,
//   passwordLoaded: !!process.env.DB_PASSWORD,
//   passwordLength: process.env.DB_PASSWORD?.length,
// });

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // AU-1: global per-IP rate limit (300 req/min — room for 3 s polling),
    // with tighter per-route overrides on the OTP endpoints.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: Number(config.get<string>('DB_PORT') ?? 5432),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE'),
        autoLoadEntities: true,
        synchronize: (config.get<string>('DB_SYNCHRONIZE') ?? 'false') === 'true',
        logging: (config.get<string>('DB_LOGGING') ?? 'false') === 'true',
        // PERF: keep pooled connections alive. Managed Postgres hosts silently
        // drop idle TCP connections; the next request (e.g. the driver's
        // "Accept Ride" tap after minutes of waiting) then paid a full
        // reconnect + SSL handshake, which showed up as a multi-second stall.
        extra: { keepAlive: true, keepAliveInitialDelayMillis: 10_000 },
        // Only disable cert verification for managed dev DBs; in prod use proper CA.
        ssl:
          (config.get<string>('DB_SSL') ?? 'true') === 'false'
            ? false
            : (config.get<string>('NODE_ENV') ?? 'development') === 'production'
              ? { rejectUnauthorized: true }
              : { rejectUnauthorized: false },
      }),
    }),
    // Global bridge for cross-module events (admin application notifications).
    CommonModule,
    RedisModule,
    AuthModule,
    DriversModule,
    RidesModule,
    PaymentsModule,
    AdminModule,
    PlacesModule,
    PromosModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}