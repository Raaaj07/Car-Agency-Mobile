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
 * Phase-1.1: a revoked session must also drop that device's live socket.
 * `AuthService` cannot import `RidesModule` without coupling auth to rides
 * (and `RidesModule` is already the top of the module graph), so it announces
 * the revocation here and `RidesGateway` — which registers at boot — closes
 * the matching sockets.
 */
export interface SessionRevokedEvent {
  userId: string;
  /** Revoke only this device's sockets; omit to drop every socket of the user. */
  sessionId?: string;
  reason: string;
}

type SessionRevokedNotifier = (payload: SessionRevokedEvent) => void;

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
  private sessionRevokedNotifier: SessionRevokedNotifier | null = null;

  register(notifier: Notifier): void {
    this.notifier = notifier;
  }

  /** Phase-1.1: register the single listener that closes revoked sockets. */
  registerSessionRevoked(notifier: SessionRevokedNotifier): void {
    this.sessionRevokedNotifier = notifier;
  }

  /**
   * Phase-1.1: best-effort — a failure here must never turn a successful
   * logout/account deletion into a 500 (the session rows are already dead, so
   * the next request/handshake is rejected anyway).
   */
  emitSessionRevoked(payload: SessionRevokedEvent): void {
    if (!this.sessionRevokedNotifier) return;
    try {
      this.sessionRevokedNotifier(payload);
    } catch (err) {
      this.logger.warn(`Session-revoked notifier failed: ${(err as Error).message}`);
    }
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
