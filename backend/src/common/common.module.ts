import { Global, Module } from '@nestjs/common';
import { ApplicationEventsService } from './events/application-events.service';

/**
 * Cross-module utilities that must be injectable everywhere (Drivers, Rides,
 * Admin) without introducing import cycles.
 */
@Global()
@Module({
  providers: [ApplicationEventsService],
  exports: [ApplicationEventsService],
})
export class CommonModule {}
