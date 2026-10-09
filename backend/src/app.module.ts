import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation';
import { resolveDbSsl } from './config/db-ssl';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { UserKeyedThrottlerGuard } from './common/guards/user-keyed-throttler.guard';
import { RedisModule } from './config/redis.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { PlacesModule } from './places/places.module';
import { PromosModule } from './promos/promos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // AU-1: global rate limit (300 req/min — room for 3 s polling), with
    // tighter per-route overrides on the OTP endpoints. SEC-5: buckets are
    // keyed PER USER for authenticated traffic and per IP for anonymous —
    // see UserKeyedThrottlerGuard (CGNAT/proxy fairness, rotation-proof).
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
        // SEC-11: the same SSL policy as the migration CLI (config/db-ssl) —
        // DB_SSL=false disables TLS; otherwise DB_SSL_REJECT_UNAUTHORIZED
        // overrides the default (strict in production, relaxed in dev), so
        // `migration:run` and the app can never disagree about it.
        ssl: resolveDbSsl({
          DB_SSL: config.get<string>('DB_SSL'),
          DB_SSL_REJECT_UNAUTHORIZED: config.get<string>('DB_SSL_REJECT_UNAUTHORIZED'),
          NODE_ENV: config.get<string>('NODE_ENV'),
        }),
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
    // Order matters: rate-limit first (cheap, caps request volume before any
    // JWT work), then default-deny auth. SEC-1: JwtAuthGuard is now global —
    // every route requires a bearer token unless its handler/controller is
    // marked @Public() (OTP, refresh, social sign-in, image streams).
    { provide: APP_GUARD, useClass: UserKeyedThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}