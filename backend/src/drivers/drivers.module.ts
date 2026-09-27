import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverEntity } from './entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity'; // ADD
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { GeoService } from './geo.service';

@Module({
  imports: [TypeOrmModule.forFeature([DriverEntity, RideEntity])], // ADD RideEntity
  controllers: [DriversController],
  providers: [DriversService, GeoService],
  exports: [DriversService, GeoService, TypeOrmModule],
})
export class DriversModule {}