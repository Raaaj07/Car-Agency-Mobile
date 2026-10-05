import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { DriversModule } from '../drivers/drivers.module';
import { RideEntity } from './entities/ride.entity';
import { RidesGateway } from './gateway/rides.gateway';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { RouteDistanceService } from './route-distance.service';
import { PromosModule } from '../promos/promos.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([RideEntity, DriverEntity, UserEntity]),
    DriversModule,
    PromosModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [RidesController],
  providers: [RidesService, RidesGateway, RouteDistanceService],
  exports: [RidesService, RidesGateway, RouteDistanceService, TypeOrmModule],
})
export class RidesModule {}
