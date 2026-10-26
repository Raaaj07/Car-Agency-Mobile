import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { AdminPromosController } from './admin-promos.controller';
import { PromosController } from './promos.controller';
import { PromoEntity } from './entities/promo.entity';
import { PromoRedemptionEntity } from './entities/promo-redemption.entity';
import { PromosService } from './promos.service';
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RideEntity, PromoEntity, PromoRedemptionEntity, AdminAuditLogEntity])],
  controllers: [PromosController, AdminPromosController],
  providers: [PromosService],
  exports: [PromosService],
})
export class PromosModule {}
