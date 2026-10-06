import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { AdminPromosController } from './admin-promos.controller';
import { PromosController } from './promos.controller';
import { PromoEntity } from './entities/promo.entity';
import { PromoRedemptionEntity } from './entities/promo-redemption.entity';
import { PromosService } from './promos.service';

@Module({
  imports: [TypeOrmModule.forFeature([RideEntity, PromoEntity, PromoRedemptionEntity])],
  controllers: [PromosController, AdminPromosController],
  providers: [PromosService],
  exports: [PromosService],
})
export class PromosModule {}
