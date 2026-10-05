import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverEntity } from './entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity'; // ADD
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { GeoService } from './geo.service';
import { StorageService } from './storage.service';
import { ApprovedDriverGuard } from './guards/approved-driver.guard';

@Module({
  // AdminAuditLogEntity: D-1 writes the `upi_update` audit row directly — the
  // admin module already imports this one, so injecting its service back
  // would create a circular module dependency.
  imports: [TypeOrmModule.forFeature([DriverEntity, RideEntity, AdminAuditLogEntity])], // ADD RideEntity
  controllers: [DriversController],
  providers: [DriversService, GeoService, StorageService, ApprovedDriverGuard],
  exports: [DriversService, GeoService, StorageService, ApprovedDriverGuard, TypeOrmModule],
})
export class DriversModule {}