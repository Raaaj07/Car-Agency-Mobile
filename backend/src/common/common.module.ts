import { Global, Module } from '@nestjs/common';
import { ApplicationEventsService } from './events/application-events.service';
import { HealthController } from './health.controller';

/**
 * Cross-module utilities that must be injectable everywhere (Drivers, Rides,
 * Admin) without introducing import cycles. Also hosts the unauthenticated
 * /health probe (task 9) — it needs only DataSource + REDIS_CLIENT.
 */
@Global()
@Module({
  controllers: [HealthController],
  providers: [ApplicationEventsService],
  exports: [ApplicationEventsService],
})
export class CommonModule {}
