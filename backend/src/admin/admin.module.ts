import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { PaymentEntity } from '../payments/entities/payment.entity';
import { DriversModule } from '../drivers/drivers.module';
import { RidesModule } from '../rides/rides.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, DriverEntity, RideEntity, PaymentEntity, AdminAuditLogEntity]),
    DriversModule,
    RidesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAuditService],
  exports: [AdminService],
})
export class AdminModule {}
