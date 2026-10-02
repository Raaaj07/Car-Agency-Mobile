import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverEntity } from './entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity'; // ADD
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { GeoService } from './geo.service';
import { StorageService } from './storage.service';
import { ApprovedDriverGuard } from './guards/approved-driver.guard';

@Module({
  imports: [TypeOrmModule.forFeature([DriverEntity, RideEntity])], // ADD RideEntity
  controllers: [DriversController],
  providers: [DriversService, GeoService, StorageService, ApprovedDriverGuard],
  exports: [DriversService, GeoService, StorageService, ApprovedDriverGuard, TypeOrmModule],
})
export class DriversModule {}