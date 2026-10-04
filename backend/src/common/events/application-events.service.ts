import { Injectable, Logger } from '@nestjs/common';

/** Payload pushed to the admin socket room when an application arrives/re-arrives. */
export interface ApplicationNewEvent {
  driverId: string;
  userId: string;
  status: string;
  submittedAt: Date;
}

type Notifier = (payload: ApplicationNewEvent) => void;

/**
 * Tiny pub/sub bridge so `DriversService` can announce a new driver
 * application (A-11) without importing `RidesModule` — which already imports
 * `DriversModule` and would become circular. `RidesGateway` registers itself
 * once at boot; emission is a best-effort no-op until then.
 */
@Injectable()
export class ApplicationEventsService {
  private readonly logger = new Logger(ApplicationEventsService.name);
  private notifier: Notifier | null = null;

  register(notifier: Notifier): void {
    this.notifier = notifier;
  }

  emitApplicationNew(payload: ApplicationNewEvent): void {
    if (!this.notifier) return;
    try {
      this.notifier(payload);
    } catch (err) {
      this.logger.error(`admin:application:new emit failed: ${(err as Error).message}`);
    }
  }
}
