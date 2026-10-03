import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation';
import { RedisModule } from './config/redis.module';
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
        // Only disable cert verification for managed dev DBs; in prod use proper CA.
        ssl:
          (config.get<string>('DB_SSL') ?? 'true') === 'false'
            ? false
            : (config.get<string>('NODE_ENV') ?? 'development') === 'production'
              ? { rejectUnauthorized: true }
              : { rejectUnauthorized: false },
      }),
    }),
    RedisModule,
    AuthModule,
    DriversModule,
    RidesModule,
    PaymentsModule,
    AdminModule,
    PlacesModule,
    PromosModule,
  ],
})
export class AppModule {}