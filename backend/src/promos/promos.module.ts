import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';

@Module({
  imports: [TypeOrmModule.forFeature([RideEntity])],
  controllers: [PromosController],
  providers: [PromosService],
  exports: [PromosService],
})
export class PromosModule {}
