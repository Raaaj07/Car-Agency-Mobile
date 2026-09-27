import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversModule } from '../drivers/drivers.module';
import { RideEntity } from './entities/ride.entity';
import { RidesGateway } from './gateway/rides.gateway';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RideEntity]),
    DriversModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [RidesController],
  providers: [RidesService, RidesGateway],
  exports: [RidesService, TypeOrmModule],
})
export class RidesModule {}
