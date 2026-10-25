import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { EntityManager, In, IsNull, LessThan, MoreThan, QueryRunner, Repository } from 'typeorm';
import { PaymentEntity } from '../payments/entities/payment.entity';
import { AdminAuditLogEntity } from '../admin/entities/admin-audit-log.entity';
import { REDIS_CLIENT } from '../config/redis.module';
import { toAvatarUrl } from '../common/avatar-url';
import { haversineKm } from '../common/geo-utils';
import { DriversService } from '../drivers/drivers.service';
import { GeoService } from '../drivers/geo.service';
import { VehicleType } from '../drivers/entities/driver.entity';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { CompleteRideDto } from './dto/complete-ride.dto';
import { CreateRideDto } from './dto/create-ride.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { VerifyPickupOtpDto } from './dto/verify-pickup-otp.dto';
import { RideEntity, ACTIVE_RIDE_STATUSES } from './entities/ride.entity';
// Re-export: the booking pre-check and findActiveForRider() consume this.
export { ACTIVE_RIDE_STATUSES };
import { computeFareBreakdown, computeNumericPrice } from './fare-catalog';
import { RouteDistanceService } from './route-distance.service';
import { RidesGateway } from './gateway/rides.gateway';
import { PromosService } from '../promos/promos.service';
import { PushService } from '../notifications/push.service';



function generateOtp(length = 4): string {
  // crypto-secure OTP: Math.random is predictable.
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, '0');
}

// R-5: offer/search timers live in a Redis sorted set so they survive
// restarts and are shared by every backend instance. Member format
// `<kind>:<rideId>` (kind = `offer` | `search`), score = due epoch-ms.
export const RIDE_TIMERS_KEY = 'ride:timers';
// Every instance polls the set every 5 s and claims due entries with an
// atomic ZREM: exactly one instance wins a given timer, and the handlers are
// idempotent (conditional updates / row locks), so nothing can double-fire.
export const TIMER_SWEEP_MS = 5_000;

// Pass-4 (task 6): hard trip-fraud limits — block only absurd input.
const DEFAULT_MAX_TRIP_KM = 150;
const MIN_TRIP_DISTANCE_KM = 0.1; // pickup == dropoff (< 100 m straight-line)
// Soft flags: a driver ping older than this is too stale to judge.
const FLAG_FRESH_MS = 5 * 60_000;
const FLAG_DISTANCE_KM = 1;
// A repeat POST /rides for the SAME trip this soon after the first is a
// double-tap / network retry: replay the existing ride instead of answering 409.
const DUPLICATE_BOOKING_WINDOW_MS = 60_000;
// Redis timer bookkeeping is best-effort (the stale sweeps are the safety net),
// so it must never make a booking or cancel wait on a slow/unreachable Redis.
const REDIS_TIMER_WAIT_MS = 1_500;
function raceTimeout<T>(p: Promise<T>, ms = REDIS_TIMER_WAIT_MS): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

type ServiceAreaBbox = { minLat: number; minLng: number; maxLat: number; maxLng: number };

function parseServiceAreaBbox(raw: string | undefined): ServiceAreaBbox | null {
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLat, minLng, maxLat, maxLng] = parts;
  return { minLat, minLng, maxLat, maxLng };
}

@Injectable()
export class RidesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly requestTimeoutSeconds: number;
  // Pass-4 (task 6): hard booking limits (see module constants).
  private readonly maxTripKm: number;
  private readonly serviceAreaBbox: ServiceAreaBbox | null;
  // R-1: max time a ride may sit in `requested` with nobody offering.
  private readonly searchTimeoutSeconds: number;
  private readonly logger = new Logger(RidesService.name);
  private staleSweepTimer: NodeJS.Timeout | null = null;
  // R-5: polls the shared `ride:timers` zset (see RIDE_TIMERS_KEY).
  private timerSweepTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    private readonly drivers: DriversService,
    private readonly geo: GeoService,
    private readonly gateway: RidesGateway,
    private readonly config: ConfigService,
    private readonly promosService: PromosService,
    private readonly routes: RouteDistanceService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // Optional so unit tests (and a missing module) never block the ride flow.
    @Optional() private readonly push?: PushService,
  ) {
    this.requestTimeoutSeconds = this.config.get<number>('RIDE_REQUEST_TIMEOUT_SECONDS') ?? 15;
    this.searchTimeoutSeconds = this.config.get<number>('RIDE_SEARCH_TIMEOUT_SECONDS') ?? 90;
    const maxTripKm = Number(this.config.get<string>('MAX_TRIP_KM'));
    this.maxTripKm = Number.isFinite(maxTripKm) && maxTripKm > 0 ? maxTripKm : DEFAULT_MAX_TRIP_KM;
    this.serviceAreaBbox = parseServiceAreaBbox(this.config.get<string>('SERVICE_AREA_BBOX'));
  }

  // Startup sweep: recover from server restarts so no drivers are permanently reserved
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Running startup sweep for pending requested rides...');
    try {
      const pendingRides = await this.rides.find({
        where: { status: 'requested' },
      });
      const now = Date.now();
      for (const loaded of pendingRides) {
        if (loaded.driverId && loaded.offerExpiresAt && loaded.offerExpiresAt.getTime() > now) {
          const remainingMs = loaded.offerExpiresAt.getTime() - now;
          this.logger.log(`Re-arming offer timeout for ride ${loaded.id} (${remainingMs}ms remaining)`);
          await this.scheduleOfferTimeout(loaded.id, remainingMs);
          continue;
        }
        // Offer expired during downtime: release the driver and re-offer or
        // cancel. Pass-4 (task 2): the write runs under the row lock against
        // the FRESH row (the loaded one may be minutes stale) as a
        // conditional update — never save() of a row read before the lock.
        try {
          const outcome = await this.withRideLock(loaded.id, async (ride, manager) => {
            if (ride.status !== 'requested') return null; // progressed while booting
            const expiredDriverId = ride.driverId ?? null;
            const declined = expiredDriverId
              ? [...(ride.declinedDriverIds || []), expiredDriverId]
              : ride.declinedDriverIds || [];
            const giveUp = declined.length >= 3;
            const result = await manager.update(
              RideEntity,
              { id: ride.id, status: 'requested', driverId: ride.driverId },
              {
                declinedDriverIds: declined,
                driverId: null,
                ...(giveUp
                  ? {
                      status: 'cancelled' as const,
                      cancellationReason: 'no_drivers_available',
                      cancelledBy: 'system',
                      cancelledAt: new Date(),
                    }
                  : {}),
              },
            );
            if (!result.affected) return null;
            return { rideId: ride.id, expiredDriverId, giveUp };
          });
          if (!outcome) continue;
          if (outcome.expiredDriverId) {
            await this.drivers.setAvailability(outcome.expiredDriverId, true).catch(() => {});
          }
          const fresh = await this.rides.findOne({ where: { id: outcome.rideId } });
          if (!fresh) continue;
          if (outcome.giveUp) {
            this.pushStatus(fresh);
          } else if (fresh.status === 'requested' && !fresh.driverId) {
            // rematch() re-reads the ride under the lock before offering
            // again — the pre-lock snapshot is stale by definition.
            try {
              await this.rematch(fresh.id, fresh.riderId);
            } catch (err) {
              this.logger.error(`Startup sweep re-match failed for ride ${fresh.id}`, err as Error);
            }
          }
        } catch (err) {
          this.logger.error(`Startup sweep failed for ride ${loaded.id}`, err as Error);
        }
      }
    } catch (err) {
      this.logger.error('Startup sweep failed', err as Error);
    }

    // Release rides that were already stuck before this deploy so nobody is
    // locked out waiting for the first 5-minute tick.
    try {
      const released = await this.sweepStaleRides();
      if (released > 0) {
        this.logger.log(`Startup stale-ride sweep released ${released} ride(s)`);
      }
    } catch (err) {
      this.logger.error('Startup stale-ride sweep failed', err as Error);
    }

    // Stale-ride safety net: rides stuck in matched / driver_en_route /
    // in_progress (e.g. driver app closed) must never lock the rider out
    // forever. Runs every 5 minutes via setInterval (no new dependency).
    this.staleSweepTimer = setInterval(() => {
      this.sweepStaleRides().catch((err) => {
        this.logger.error('Stale ride sweep failed', err as Error);
      });
    }, 5 * 60 * 1000);
    // Don't keep the process alive just for this timer in tests/scripts.
    if (typeof this.staleSweepTimer.unref === 'function') {
      this.staleSweepTimer.unref();
    }

    // R-5: fire offer/search timers that came due while this instance was
    // down (they persisted in Redis), then keep polling every 5 s. The
    // ZREM claim keeps concurrent instances from double-firing.
    this.sweepDueTimers().catch((err) => {
      this.logger.error('Startup timer sweep failed', err as Error);
    });
    this.timerSweepTimer = setInterval(() => {
      this.sweepDueTimers().catch((err) => {
        this.logger.error('Timer sweep failed', err as Error);
      });
    }, TIMER_SWEEP_MS);
    if (typeof this.timerSweepTimer.unref === 'function') {
      this.timerSweepTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.staleSweepTimer) {
      clearInterval(this.staleSweepTimer);
      this.staleSweepTimer = null;
    }
    if (this.timerSweepTimer) {
      clearInterval(this.timerSweepTimer);
      this.timerSweepTimer = null;
    }
    // Redis timers are intentionally NOT deleted: they belong to the shared
    // `ride:timers` set (other instances still need them; a restart re-arms).
  }

  // Auto-cancels rides abandoned mid-flow: matched/driver_en_route untouched
  // for 60 minutes, in_progress untouched for 6 hours, and requested rides
  // with no offer for 5 minutes (R-1 — no driver came forward). Frees the
  // driver and pushes the status so the rider can book again.
  async sweepStaleRides(now = new Date()): Promise<number> {
    const assignedCutoff = new Date(now.getTime() - 60 * 60 * 1000);
    const tripCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const searchCutoff = new Date(now.getTime() - 5 * 60 * 1000);
    const staleAssigned = await this.rides.find({
      where: { status: In(['matched', 'driver_en_route']), updatedAt: LessThan(assignedCutoff) },
    });
    const staleTrips = await this.rides.find({
      where: { status: In(['in_progress']), updatedAt: LessThan(tripCutoff) },
    });
    const staleSearches = await this.rides.find({
      where: { status: 'requested', driverId: IsNull(), updatedAt: LessThan(searchCutoff) },
    });
    const stale: Array<{ ride: RideEntity; reason: string }> = [
      ...staleAssigned.map((ride) => ({ ride, reason: 'stale_ride_timeout' })),
      ...staleTrips.map((ride) => ({ ride, reason: 'stale_ride_timeout' })),
      ...staleSearches.map((ride) => ({ ride, reason: 'no_drivers_available' })),
    ];
    let cancelled = 0;
    for (const { ride, reason } of stale) {
      try {
        // Captured before mutation so the log shows the real previous status.
        const previousStatus = ride.status;
        // Conditional update: only cancel if the status AND driver are still
        // the exact ones we judged stale, so a ride that progressed between
        // find() and now (e.g. matched -> driver_en_route) or that got
        // re-offered to a DIFFERENT driver is never touched — and the
        // driver we free below is always the driver still on the row.
        const result = await this.rides.update(
          { id: ride.id, status: previousStatus, driverId: ride.driverId ?? IsNull() },
          {
            status: 'cancelled',
            cancelledBy: 'system',
            cancellationReason: reason,
            cancelledAt: new Date(),
          },
        );
        if (!result.affected) continue;
        await this.clearOfferTimeout(ride.id);
        await this.clearSearchTimeout(ride.id);
        ride.status = 'cancelled';
        ride.cancelledBy = 'system';
        ride.cancellationReason = reason;
        ride.cancelledAt = new Date();
        if (ride.driverId) {
          await this.drivers.setAvailability(ride.driverId, true).catch(() => {});
        }
        this.pushStatus(ride);
        cancelled += 1;
        this.logger.warn(`Stale ride ${ride.id} (${previousStatus}) auto-cancelled`);
      } catch (err) {
        this.logger.error(`Failed to auto-cancel stale ride ${ride.id}`, err as Error);
      }
    }
    return cancelled;
  }

  // GET /rides/active — the rider's single most recent active ride, or null.
  async findActiveForRider(userId: string): Promise<any | null> {
    const ride = await this.rides.findOne({
      where: { riderId: userId, status: In([...ACTIVE_RIDE_STATUSES]) },
      order: { createdAt: 'DESC' },
      relations: ['rider', 'driver', 'driver.user'],
    });
    return ride ? this.toRiderView(ride) : null;
  }

  // GET /rides/driver/active — the driver's in-flight trip, or null, so the
  // driver app can re-enter it after a restart / back-navigation / reconnect.
  // Covers matched, driver_en_route and in_progress, plus a trip completed in
  // the last 24 h whose payment the driver has not yet confirmed (so the
  // "Amount Received" step can be resumed). Never throws for a user with no
  // driver profile — returns null.
  async findActiveForDriver(driverUserId: string): Promise<any | null> {
    const driver = await this.drivers.findByUserId(driverUserId).catch(() => null);
    if (!driver) return null;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ride = await this.rides.findOne({
      where: [
        { driverId: driver.id, status: In(['matched', 'driver_en_route', 'in_progress']) },
        {
          driverId: driver.id,
          status: 'completed',
          paymentStatus: In(['pending', 'rider_claimed', 'failed']),
          completedAt: MoreThan(dayAgo),
        },
      ],
      order: { updatedAt: 'DESC' },
      relations: ['rider'],
    });
    return ride ? this.toDriverView(ride) : null;
  }

  // ── R-5: Redis-backed offer/search timers ────────────────────────────────
  // Members of the `ride:timers` zset (RIDE_TIMERS_KEY): `offer:<rideId>` /
  // `search:<rideId>`, score = due epoch-ms. Arming is a plain ZADD (re-arm
  // overwrites the score), clearing is a ZREM, and firing happens in
  // sweepDueTimers() below — never in a per-process setTimeout.

  private async armTimer(kind: 'offer' | 'search', rideId: string, timeoutMs: number): Promise<void> {
    try {
      await raceTimeout(this.redis.zadd(RIDE_TIMERS_KEY, Date.now() + timeoutMs, `${kind}:${rideId}`));
    } catch (err) {
      // Booking must not fail because Redis blipped — sweepStaleRides() is
      // the safety net for a timer that never made it to the zset.
      this.logger.error(`Failed to arm ${kind} timer for ride ${rideId}: ${(err as Error).message}`);
    }
  }

  private async clearTimer(kind: 'offer' | 'search', rideId: string): Promise<void> {
    try {
      await raceTimeout(this.redis.zrem(RIDE_TIMERS_KEY, `${kind}:${rideId}`));
    } catch (err) {
      this.logger.warn(`Failed to clear ${kind} timer for ride ${rideId}: ${(err as Error).message}`);
    }
  }

  private clearOfferTimeout(rideId: string): Promise<void> {
    return this.clearTimer('offer', rideId);
  }

  private clearSearchTimeout(rideId: string): Promise<void> {
    return this.clearTimer('search', rideId);
  }

  /**
   * Drops every timer for a ride. Public for admin-side cancels (suspend
   * force, admin ride cancel) so an offered driver never stays reserved
   * after the ride is gone — same discipline as the R-2 fix.
   */
  async clearPendingTimers(rideId: string): Promise<void> {
    await Promise.all([this.clearOfferTimeout(rideId), this.clearSearchTimeout(rideId)]);
  }

  /**
   * Poll the shared timer set and fire everything that is due. Each entry is
   * claimed with an atomic ZREM first: when two instances sweep the same
   * member concurrently, exactly one gets `1` back and only that one runs the
   * handler — the loser skips it. Handlers themselves are idempotent
   * (conditional updates / pessimistic locks), so a late duplicate is a no-op.
   * `sweepStaleRides()` remains the safety net for anything a timer misses.
   */
  async sweepDueTimers(nowMs = Date.now()): Promise<number> {
    let due: string[] = [];
    try {
      due = await this.redis.zrangebyscore(RIDE_TIMERS_KEY, 0, nowMs);
    } catch (err) {
      this.logger.error(`Timer sweep failed: ${(err as Error).message}`);
      return 0;
    }
    let fired = 0;
    for (const member of due) {
      try {
        const won = await this.redis.zrem(RIDE_TIMERS_KEY, member); // atomic claim
        if (won !== 1) continue; // another instance got there first
        const sep = member.indexOf(':');
        const kind = member.slice(0, sep);
        const rideId = member.slice(sep + 1);
        if (kind === 'offer') {
          await this.fireOfferTimeout(rideId);
        } else if (kind === 'search') {
          await this.fireSearchTimeout(rideId);
        }
        fired += 1;
      } catch (err) {
        this.logger.error(`Timer handler failed for ${member}: ${(err as Error).message}`);
      }
    }
    return fired;
  }

  // R-1: without this, a "no drivers nearby" ride stays `requested` forever —
  // the stale sweep skips that status and the rider is locked out of booking.
  // Only cancels a ride that is still requested AND unassigned (a driver who
  // appeared meanwhile wins).
  private scheduleSearchTimeout(rideId: string, timeoutMs: number): Promise<void> {
    return this.armTimer('search', rideId, timeoutMs);
  }

  private scheduleOfferTimeout(rideId: string, timeoutMs: number): Promise<void> {
    return this.armTimer('offer', rideId, timeoutMs);
  }

  /** Fires once after the search window (claimed from `ride:timers`). */
  private async fireSearchTimeout(rideId: string): Promise<void> {
    try {
      // Pass-4 (task 2): the check + write run under the ride row lock, so a
      // driver appearing (or the rider cancelling) between the read and the
      // write can never be overwritten by a stale update.
      const cancelled = await this.withRideLock(rideId, async (ride, manager) => {
        if (ride.status !== 'requested' || ride.driverId) return false;
        const result = await manager.update(
          RideEntity,
          { id: rideId, status: 'requested', driverId: IsNull() },
          {
            status: 'cancelled',
            cancelledBy: 'system',
            cancellationReason: 'no_drivers_available',
            cancelledAt: new Date(),
          },
        );
        return result.affected === 1;
      }).catch((err) => {
        // The ride is gone (cancelled+deleted) — nothing left to time out.
        if (err instanceof NotFoundException) return false;
        throw err;
      });
      if (!cancelled) return;
      this.logger.warn(`Ride ${rideId} search timed out after ${this.searchTimeoutSeconds}s (no drivers)`);
      // Reload after commit (withRideLock contract) for the status push.
      const ride = await this.rides.findOne({ where: { id: rideId } });
      if (ride) this.pushStatus(ride);
    } catch (err) {
      this.logger.error(`Search timeout failed for ride ${rideId}`, err as Error);
    }
  }

  /** Releases the offered driver and re-matches (claimed from `ride:timers`). */
  private async fireOfferTimeout(rideId: string): Promise<void> {
    try {
      // Pass-4 (task 2): check + write under the row lock. The old
      // findOne-then-save sequence could undo a driver's accept or a rider's
      // cancel that landed in between — flipping the ride back to
      // `requested` or resurrecting a cancelled one.
      const outcome = await this.withRideLock(rideId, async (ride, manager) => {
        // Accepted (status matched) or cancelled meanwhile → no-op.
        if (ride.status !== 'requested' || !ride.driverId) return null;
        const driverId = ride.driverId;
        const declined = [...(ride.declinedDriverIds || []), driverId];
        const giveUp = declined.length >= 3;
        // Only the timer's own fields, re-validated against the locked row.
        const result = await manager.update(
          RideEntity,
          { id: ride.id, status: 'requested', driverId },
          {
            declinedDriverIds: declined,
            driverId: null,
            ...(giveUp
              ? {
                  status: 'cancelled' as const,
                  cancellationReason: 'no_drivers_available',
                  cancelledBy: 'system',
                  cancelledAt: new Date(),
                }
              : {}),
          },
        );
        if (!result.affected) return null;
        return { giveUp, driverId };
      }).catch((err) => {
        if (err instanceof NotFoundException) return null; // ride deleted
        throw err;
      });
      if (!outcome) return;

      this.logger.warn(`Offer timed out for ride ${rideId} with driver ${outcome.driverId}`);
      // Side effects AFTER commit (withRideLock contract): free the driver,
      // then re-match on a FRESH read — never the pre-lock snapshot.
      await this.drivers.setAvailability(outcome.driverId, true);
      const ride = await this.rides.findOne({ where: { id: rideId } });
      if (!ride) return;
      if (outcome.giveUp) {
        this.pushStatus(ride);
        this.logger.warn(`Ride ${rideId} cancelled after 3 failed/expired driver offers`);
      } else if (ride.status === 'requested' && !ride.driverId) {
        // rematch() re-reads the ride under the lock before offering again.
        try {
          await this.rematch(ride.id, ride.riderId);
        } catch (err) {
          this.logger.error(`Re-match after timed-out offer failed for ride ${rideId}`, err as Error);
        }
      }
    } catch (err) {
      this.logger.error(`Error in offer timeout handler for ride ${rideId}`, err as Error);
    }
  }

  /**
   * SEC-9: run `fn` in its own transaction — commit on success, rollback and
   * rethrow on any throw. Extracted from withRideLock so a booking that must
   * validate a promo row lock (promos assertBookable) and INSERT the ride
   * atomically reuses the same plumbing. Callers do side effects AFTER this
   * returns (the commit has happened), per the withRideLock contract.
   */
  private async withTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    const queryRunner: QueryRunner = this.rides.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await fn(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => {});
      throw err;
    } finally {
      await queryRunner.release().catch(() => {});
    }
  }

  /**
   * R-4: run a ride transition under a pessimistic row lock inside a
   * transaction (same discipline as accept()/cancel()), so a concurrent
   * decline/timeout/cancel/complete cannot interleave and double-release a
   * driver, double-charge, or resurrect a cancelled ride.
   *
   * Contract:
   *  - `fn` receives the locked (relation-less) row; it must save `ride`
   *    itself if it mutates it (all saves join the same transaction);
   *  - throwing rolls the transaction back and rethrows;
   *  - on success the transaction commits before the helper returns, so
   *    callers do side effects (pushStatus, timer clears, re-matching,
   *    relation reloads) AFTER `await withRideLock(...)`.
   */
  private async withRideLock<T>(
    rideId: string,
    fn: (ride: RideEntity, manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(async (manager) => {
      const ride = await manager.findOne(RideEntity, {
        where: { id: rideId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ride) throw new NotFoundException('Ride not found');
      return fn(ride, manager);
    });
  }

  // POST /rides — create + trigger nearest-driver matching.
  // Rules: no second active ride as rider; online drivers must go offline
  // first (they cannot book while advertising availability).
  // Task 11: Idempotency-Key support stored in Redis for 60 seconds
  async create(riderId: string, dto: CreateRideDto, idempotencyKey?: string): Promise<any> {
    if (idempotencyKey) {
      const cacheKey = `idempotency:rides:${riderId}:${idempotencyKey}`;
      try {
        const cached = await raceTimeout(this.redis.get(cacheKey));
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err) {
        this.logger.warn(`Idempotency check failed: ${(err as Error).message}`);
      }
    }

    // The two checks are independent: run them together (one round trip less).
    const [active, ownDriver] = await Promise.all([
      this.rides.count({
        where: { riderId, status: In([...ACTIVE_RIDE_STATUSES]) },
      }),
      this.drivers.findByUserId(riderId).catch(() => null),
    ]);
    if (active > 0) {
      // Double-tap / retry of the SAME booking: hand back that ride, not an error.
      const replay = await this.replayRecentBooking(riderId, dto);
      if (replay) {
        if (idempotencyKey) {
          const cacheKey = `idempotency:rides:${riderId}:${idempotencyKey}`;
          await raceTimeout(this.redis.set(cacheKey, JSON.stringify(replay), 'EX', 60)).catch(() => {});
        }
        return replay;
      }
      // 409 (not 400): "the resource is in a state that rejects this
      // request" — the frontend surfaces the message either way.
      throw new ConflictException('You already have an active ride. Cancel or complete it first.');
    }
    if (ownDriver?.isOnline) {
      throw new BadRequestException('Go offline as a driver before booking a ride.');
    }
    // Pass-4 (task 6): hard trip-fraud limits — block only absurd input,
    // checked BEFORE the routed-distance call so junk never costs a Mapbox
    // lookup. Pickup == dropoff (< 100 m straight-line) is the classic
    // fare-manipulation / test-spam shape.
    const straightKm = haversineKm(dto.pickup, dto.dropoff);
    if (straightKm < MIN_TRIP_DISTANCE_KM) {
      throw new BadRequestException('Pickup and dropoff must be at least 100 m apart');
    }
    // SERVICE_AREA_BBOX (optional): both trip points must sit inside the
    // operator's region. Absent → no geographic restriction.
    if (this.serviceAreaBbox) {
      const { minLat, minLng, maxLat, maxLng } = this.serviceAreaBbox;
      const outside = (p: { lat: number; lng: number }): boolean =>
        p.lat < minLat || p.lat > maxLat || p.lng < minLng || p.lng > maxLng;
      if (outside(dto.pickup)) {
        throw new BadRequestException('Pickup is outside the service area');
      }
      if (outside(dto.dropoff)) {
        throw new BadRequestException('Dropoff is outside the service area');
      }
    }
    // R-7: fare is based on the ROUTED road distance (Mapbox, 3 s timeout,
    // straight-line x1.3 fallback) — straight-line under-counts detours.
    const distanceKm = await this.routes.routedKm(dto.pickup, dto.dropoff);
    // Pass-4 (task 6): absurdly long trips (> MAX_TRIP_KM, default 150) are
    // refused with a clear message instead of silently priced.
    if (distanceKm > this.maxTripKm) {
      throw new BadRequestException(
        `Trip distance ${distanceKm.toFixed(1)} km exceeds the ${this.maxTripKm} km limit`,
      );
    }
    const numericPrice = computeNumericPrice(dto.vehicleType, distanceKm);
    // SEC-9: store the code normalised (trim + upper) — the cap accounting
    // counts in-flight rides by exact code equality, and every lookup
    // (discountFor/recordRedemption) normalises before hitting the DB anyway.
    const promoCode = dto.promoCode ? dto.promoCode.trim().toUpperCase() : null;

    const makeRide = (discount: number): RideEntity =>
      this.rides.create({
        riderId,
        status: 'requested',
        vehicleType: dto.vehicleType,
        pickup: dto.pickup,
        dropoff: dto.dropoff,
        promoCode,
        fareBreakdown: computeFareBreakdown(numericPrice, discount),
        distanceKm: distanceKm.toFixed(2),
        paymentMethod: dto.paymentMethod ?? 'upi',
        paymentStatus: 'pending',
        pickupOtp: generateOtp(),
        declinedDriverIds: [],
        otpAttempts: 0,
      });

    const persist = async (ride: RideEntity, em?: EntityManager): Promise<RideEntity> => {
      try {
        return em ? await em.save(ride) : await this.rides.save(ride);
      } catch (err) {
        // SEC-4: two concurrent POST /rides both passed the count() pre-check
        // above — the partial unique index UQ_rides_active_per_rider rejects
        // the second INSERT (Postgres 23505). The database is the only place
        // this race can be closed; map its violation onto the same conflict
        // (409) + friendly message the pre-check uses. Anything else still
        // surfaces as-is.
        const e = err as { code?: string; driverError?: { code?: string } };
        if (e.code === '23505' || e.driverError?.code === '23505') {
          throw new ConflictException('You already have an active ride. Cancel or complete it first.');
        }
        throw err;
      }
    };

    let ride: RideEntity;
    try {
    if (promoCode) {
      // SEC-9: the promo cap check and the ride INSERT commit together while
      // the promo row is locked FOR UPDATE (promos assertBookable) —
      // concurrent bookings of the same code serialize on that lock instead
      // of all reading a stale counter, so the cap cannot be raced past.
      ride = await this.withTransaction(async (em) => {
        const discount = await this.promosService.assertBookable(em, promoCode, riderId);
        return persist(makeRide(discount), em);
      });
    } else {
      ride = await persist(makeRide(0));
    }
    } catch (err) {
      // Lost the race to our OWN twin request (double-tap): the unique index
      // rejected this INSERT because the first one already created the ride.
      if (err instanceof ConflictException) {
        const replay = await this.replayRecentBooking(riderId, dto);
        if (replay) return replay;
      }
      throw err;
    }

    let matchResult: { status: 'offered' | 'no_drivers'; candidates: number } = {
      status: 'no_drivers',
      candidates: 0,
    };

    try {
      matchResult = await this.matchNearestDriver(ride, dto.allowUpgrade);
    } catch (error) {
      this.logger.error(`matchNearestDriver failed for ride ${ride.id}`, error as Error);
    }

    const reloaded = await this.findById(ride.id, riderId);
    const response = {
      ...this.toRiderView(reloaded),
      match: matchResult,
    };
    if (idempotencyKey) {
      const cacheKey = `idempotency:rides:${riderId}:${idempotencyKey}`;
      await raceTimeout(this.redis.set(cacheKey, JSON.stringify(response), 'EX', 60)).catch(() => {});
    }
    return response;
  }

  /**
   * Double-tap / network-retry guard for POST /rides. When the rider already
   * has an ACTIVE ride created in the last minute for the SAME trip (same
   * vehicle, same pickup and dropoff), that ride IS this request: return it in
   * the normal booking shape instead of a 409, so the app shows one clean
   * booking and never an error for the second tap.
   */
  private async replayRecentBooking(riderId: string, dto: CreateRideDto): Promise<any | null> {
    const recent = await this.rides.findOne({
      where: {
        riderId,
        status: In([...ACTIVE_RIDE_STATUSES]),
        createdAt: MoreThan(new Date(Date.now() - DUPLICATE_BOOKING_WINDOW_MS)),
      },
      order: { createdAt: 'DESC' },
    });
    if (!recent) return null;
    const close = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean =>
      Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
    if (
      recent.vehicleType !== dto.vehicleType ||
      !close(recent.pickup, dto.pickup) ||
      !close(recent.dropoff, dto.dropoff)
    ) {
      return null;
    }
    const reloaded = await this.findById(recent.id, riderId);
    return {
      ...this.toRiderView(reloaded),
      match: { status: recent.driverId ? 'offered' : 'no_drivers', candidates: recent.driverId ? 1 : 0 },
    };
  }

  // POST /rides/:id/rematch — "Retry" on the client's no-drivers state (R-1).
  // Re-runs the search immediately instead of waiting out the search window;
  // returns the same view+match shape as create().
  async rematch(rideId: string, riderId: string): Promise<any> {
    // SEC-4: validate AND re-match under the pessimistic row lock. Before,
    // getOrThrow read the row lock-free: a concurrent cancel/decline/timeout
    // landing between the status check and matchNearestDriver's save let a
    // STALE row overwrite the fresh state — resurrecting a cancelled ride or
    // offering it to a second driver. The ride writes go through the
    // transaction manager so the offer commits atomically with the
    // "still requested" re-check; the reload below runs after commit, per
    // the withRideLock contract.
    const matchResult = await this.withRideLock(rideId, async (ride, manager) => {
      if (ride.riderId !== riderId) {
        throw new ForbiddenException('Not your ride');
      }
      if (ride.status !== 'requested' || ride.driverId) {
        throw new BadRequestException(`Ride is ${ride.status} and cannot be re-matched`);
      }
      let result: { status: 'offered' | 'no_drivers'; candidates: number } = {
        status: 'no_drivers',
        candidates: 0,
      };
      try {
        result = await this.matchNearestDriver(ride, false, manager);
      } catch (error) {
        this.logger.error(`matchNearestDriver failed for rematch of ride ${ride.id}`, error as Error);
      }
      return result;
    });
    const reloaded = await this.findById(rideId, riderId);
    return {
      ...this.toRiderView(reloaded),
      match: matchResult,
    };
  }

  private async matchNearestDriver(
    ride: RideEntity,
    allowUpgrade = false,
    manager?: EntityManager,
  ): Promise<{ status: 'offered' | 'no_drivers'; candidates: number }> {
    // SEC-4: when called under withRideLock (rematch) the ride writes must
    // join that transaction — an out-of-txn this.rides.save() would persist
    // a STALE row and could resurrect a ride cancelled in the meantime.
    // create() passes no manager and keeps the plain save (its row is fresh;
    // the partial unique index covers its race).
    const saveRide = (r: RideEntity) => (manager ? manager.save(r) : this.rides.save(r));
    await this.clearOfferTimeout(ride.id);

    const declinedSet = new Set(ride.declinedDriverIds || []);
    // Unified accounts: never offer a rider their own driver profile.
    const notSelf = (c: any) => !declinedSet.has(c.driverId) && c.userId !== ride.riderId;
    let candidates: any[] = [];
    let matchedStrategy = 'exact_radius';

    // Strategy 1: Exact vehicleType within default radius (5 km)
    const exactHits = await this.drivers.findNearby(
      ride.pickup.lat,
      ride.pickup.lng,
      this.config.get<number>('DRIVER_SEARCH_RADIUS_METERS') ?? 5000,
      ride.vehicleType,
    );
    candidates = (exactHits as any[]).filter(notSelf);

    // Strategy 2: Retry with radius x 2 (10 km)
    if (candidates.length === 0) {
      matchedStrategy = 'radius_x2';
      const wideHits = await this.drivers.findNearby(
        ride.pickup.lat,
        ride.pickup.lng,
        (this.config.get<number>('DRIVER_SEARCH_RADIUS_METERS') ?? 5000) * 2,
        ride.vehicleType,
      );
      candidates = (wideHits as any[]).filter(notSelf);
    }

    // Strategy 3: Compatible larger vehicle types if allowed
    if (candidates.length === 0 && allowUpgrade) {
      const upgradeOrder: Record<string, VehicleType[]> = {
        auto: ['mini', 'sedan', 'suv'],
        mini: ['sedan', 'suv'],
        sedan: ['suv'],
        suv: [],
      };
      const allowedUpgrades = upgradeOrder[ride.vehicleType] || [];
      for (const nextType of allowedUpgrades) {
        const upgradeHits = await this.drivers.findNearby(
          ride.pickup.lat,
          ride.pickup.lng,
          this.config.get<number>('DRIVER_SEARCH_RADIUS_METERS') ?? 5000,
          nextType,
        );
        const filtered = (upgradeHits as any[]).filter(notSelf);
        if (filtered.length > 0) {
          candidates = filtered;
          matchedStrategy = `upgrade_to_${nextType}`;
          break;
        }
      }
    }

    this.logger.log(`Ride ${ride.id} matching strategy: ${matchedStrategy}, candidates: ${candidates.length}`);

    if (candidates.length === 0) {
      if ((ride.declinedDriverIds?.length ?? 0) >= 3) {
        ride.status = 'cancelled';
        ride.cancellationReason = 'no_drivers_available';
        ride.cancelledBy = 'system';
        ride.cancelledAt = new Date();
        await this.clearSearchTimeout(ride.id);
        await saveRide(ride);
        this.pushStatus(ride);
      } else {
        // R-1: nobody is nearby — arm (or re-arm) the search window so the
        // rider isn't locked into `requested` forever.
        await this.scheduleSearchTimeout(ride.id, this.searchTimeoutSeconds * 1000);
      }
      return { status: 'no_drivers', candidates: 0 };
    }

    // A driver is being offered: the search window no longer applies — the
    // 15 s offer timer takes over from here.
    await this.clearSearchTimeout(ride.id);
    const nearest = candidates[0];
    await this.drivers.setAvailability(nearest.driverId, false);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.requestTimeoutSeconds * 1000);

    ride.driverId = nearest.driverId;
    ride.offeredAt = now;
    ride.offerExpiresAt = expiresAt;
    await saveRide(ride);

    const driver = await this.drivers.findById(nearest.driverId);
    const withRider = await this.rides.findOne({ where: { id: ride.id }, relations: ['rider'] });

    this.gateway.emitRideRequestToDriver(driver.userId, {
      rideId: ride.id,
      riderName: withRider?.rider?.name ?? 'Rider',
      // Profile photo shown on the driver's offer card (API-relative path).
      riderAvatar: toAvatarUrl(withRider?.riderId ?? ride.riderId, (withRider?.rider as any)?.avatar),
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      vehicleType: ride.vehicleType,
      fareBreakdown: ride.fareBreakdown,
      distanceKm: ride.distanceKm,
      expiresInSeconds: this.requestTimeoutSeconds,
      offerExpiresAt: expiresAt.toISOString(),
    });

    // The socket event only reaches a foregrounded app; a push wakes a
    // backgrounded driver app so the offer isn't silently missed.
    void this.push?.notifyDriverOffer(
      driver.userId,
      ride.id,
      Number((ride.fareBreakdown as { total?: number } | null)?.total ?? 0),
      ride.pickup?.address,
    );

    await this.scheduleOfferTimeout(ride.id, this.requestTimeoutSeconds * 1000);

    return { status: 'offered', candidates: candidates.length };
  }

  // GET /rides/offers/pending — fetch currently active offer for a driver who reconnected
  async getPendingOffer(driverUserId: string): Promise<{ ride: any; remainingSeconds: number } | null> {
    const driver = await this.drivers.findByUserId(driverUserId);
    const now = new Date();
    const ride = await this.rides.findOne({
      where: {
        driverId: driver.id,
        status: 'requested',
      },
      relations: ['rider'],
    });

    if (!ride || !ride.offerExpiresAt || ride.offerExpiresAt <= now) {
      return null;
    }

    const remainingSeconds = Math.max(0, Math.ceil((ride.offerExpiresAt.getTime() - now.getTime()) / 1000));
    return {
      ride: this.toDriverView(ride),
      remainingSeconds,
    };
  }

  // PATCH /rides/:id/accept — driver accepts (RideRequestNearbyScreen).
  // Pessimistic row lock: concurrent accepts/declines/timeouts serialize on
  // the ride row. Timer cleared only after the transition commits.
  async accept(rideId: string, driverUserId: string): Promise<any> {
    // PERF: resolve the driver BEFORE opening the transaction so the row lock
    // is held only for the check + write (it used to span an extra DB query).
    const driver = await this.drivers.findByUserId(driverUserId);

    const queryRunner = this.rides.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let matched!: RideEntity;
    try {
      const ride = await queryRunner.manager.findOne(RideEntity, {
        where: { id: rideId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ride) throw new NotFoundException('Ride not found');

      if (ride.status !== 'requested') {
        throw new BadRequestException(`Ride is ${ride.status}, cannot accept`);
      }
      if (ride.driverId !== driver.id) {
        throw new ForbiddenException('This ride was not offered to you');
      }

      ride.status = 'matched';
      if (!ride.pickupOtp) {
        ride.pickupOtp = generateOtp();
      }
      ride.matchedAt = new Date();
      // PERF: a targeted UPDATE (1 round trip). manager.save() first SELECTs
      // the row again to diff it, which is wasted work under the lock.
      await queryRunner.manager.update(
        RideEntity,
        { id: ride.id },
        { status: 'matched', pickupOtp: ride.pickupOtp, matchedAt: ride.matchedAt },
      );
      await queryRunner.commitTransaction();
      matched = ride;
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => {});
      throw err;
    } finally {
      // Release the pooled connection as soon as the transaction ends — not
      // after the reload/timer work below.
      await queryRunner.release().catch(() => {});
    }

    // PERF: notify the rider right away (the status payload needs no
    // relations, and we already know the driver's userId), then run the timer
    // clear and the response reload in parallel.
    this.pushStatus(matched, driverUserId);
    const [, updated] = await Promise.all([this.clearOfferTimeout(rideId), this.loadForDriverView(rideId)]);
    return this.toDriverView(updated);
  }

  // PATCH /rides/:id/decline — driver declines or the 15s timer lapses;
  // re-offer to the next nearest driver. R-4: validation + transition run
  // under the ride row lock; the offer timer is cleared only after the
  // commit so a failed decline keeps the offer alive.
  async decline(rideId: string, driverUserId: string): Promise<any> {
    const driver = await this.drivers.findByUserId(driverUserId);
    // Pass-4 (task 2): the re-match runs INSIDE the lock on the same fresh
    // row (mirrors rematch()). It used to run after the lock was released,
    // on the stale in-memory copy, so a cancel/accept landing in between
    // could be overwritten by the re-offer.
    await this.withRideLock(rideId, async (ride, manager) => {
      if (ride.status !== 'requested' || ride.driverId !== driver.id) {
        throw new BadRequestException('Nothing to decline');
      }
      ride.driverId = null;
      ride.declinedDriverIds = [...(ride.declinedDriverIds || []), driver.id];
      await manager.save(ride);
      try {
        await this.matchNearestDriver(ride, false, manager);
      } catch (error) {
        this.logger.error(`matchNearestDriver failed for decline of ride ${ride.id}`, error as Error);
      }
    });

    // Side effects AFTER commit (withRideLock contract). The offer/search
    // timers were already transitioned by matchNearestDriver under the lock,
    // so only the declining driver needs freeing here.
    await this.drivers.setAvailability(driver.id, true);
    const updated = await this.getOrThrow(rideId);
    return this.toDriverView(updated);
  }

  // Driver begins navigating toward the pickup point (TurnByTurnNavigationScreen).
  // R-4: locked transition — a concurrent cancel can no longer be overwritten
  // by a stale `driver_en_route` write.
  async markEnRoute(rideId: string, driverUserId: string): Promise<any> {
    // PERF: resolve the driver outside the lock (was done inside it, and again
    // later by pushStatus) and use a targeted UPDATE instead of save().
    const driver = await this.drivers.findByUserId(driverUserId);
    await this.withRideLock(rideId, async (ride, manager) => {
      if (ride.driverId !== driver.id) {
        throw new ForbiddenException('Not your ride');
      }
      if (ride.status !== 'matched') {
        throw new BadRequestException(`Ride is ${ride.status}, cannot mark en route`);
      }
      ride.status = 'driver_en_route';
      await manager.update(RideEntity, { id: ride.id }, { status: 'driver_en_route' });
    });
    const fresh = await this.loadForDriverView(rideId);
    this.pushStatus(fresh, driverUserId);
    return this.toDriverView(fresh);
  }

  // PATCH /rides/:id/start — driver has arrived and is ready to collect the
  // pickup OTP from the rider (DriverEnRouteScreen's "Driver Arrived" action).
  async start(rideId: string, driverUserId: string): Promise<{ ride: any; readyForOtp: true }> {
    const driver = await this.drivers.findByUserId(driverUserId);

    // PERF fast path: the ride is normally ALREADY `driver_en_route` (accept
    // flow calls markEnRoute), which makes start() a no-op. A plain read is
    // enough then — no transaction / row lock (3 fewer DB round trips).
    const current = await this.loadForDriverView(rideId);
    if (current.driverId !== driver.id) {
      throw new ForbiddenException('Not your ride');
    }
    if (current.status === 'driver_en_route') {
      return { ride: this.toDriverView(current), readyForOtp: true };
    }
    if (current.status !== 'matched') {
      throw new BadRequestException(`Ride is ${current.status}, cannot start pickup`);
    }

    // `matched` -> `driver_en_route` still goes through the locked transition
    // (re-validated under the lock so a concurrent cancel can't be overwritten).
    const mutated = await this.withRideLock(rideId, async (ride, manager) => {
      if (ride.driverId !== driver.id) {
        throw new ForbiddenException('Not your ride');
      }
      if (ride.status !== 'driver_en_route' && ride.status !== 'matched') {
        throw new BadRequestException(`Ride is ${ride.status}, cannot start pickup`);
      }
      if (ride.status === 'matched') {
        ride.status = 'driver_en_route';
        await manager.update(RideEntity, { id: ride.id }, { status: 'driver_en_route' });
        return true;
      }
      return false;
    });
    const fresh = await this.loadForDriverView(rideId);
    if (mutated) this.pushStatus(fresh, driverUserId);
    return { ride: this.toDriverView(fresh), readyForOtp: true };
  }

  // PATCH /rides/:id/verify-pickup-otp — confirms the code shown on
  // YouGotTheRideScreen; on success the trip formally begins.
  // R-4: the lock serializes the attempt counter and the status flip; failed
  // attempts COMMIT their counter (returned as a result, thrown by the caller
  // after the commit so the rollback cannot swallow the increment).
  async verifyPickupOtp(rideId: string, driverUserId: string, dto: VerifyPickupOtpDto): Promise<any> {
    const outcome = await this.withRideLock(rideId, async (ride, manager) => {
      await this.assertOwningDriver(ride, driverUserId);

      if (ride.otpLockedUntil && new Date() < ride.otpLockedUntil) {
        const waitSeconds = Math.ceil((ride.otpLockedUntil.getTime() - Date.now()) / 1000);
        throw new HttpException(
          `Too many incorrect OTP attempts. Locked for ${Math.ceil(waitSeconds / 60)} more minute(s).`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (ride.status !== 'driver_en_route') {
        throw new BadRequestException(`Ride is ${ride.status}, cannot verify pickup OTP`);
      }

      const expected = ride.pickupOtp ?? '';
      const bufA = Buffer.from(dto.otp);
      const bufB = Buffer.from(expected);
      const isMatch = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

      if (!isMatch) {
        ride.otpAttempts = (ride.otpAttempts || 0) + 1;
        this.logger.warn(`Ride ${rideId} incorrect OTP attempt ${ride.otpAttempts}/5`);
        if (ride.otpAttempts >= 5) {
          ride.otpLockedUntil = new Date(Date.now() + 5 * 60 * 1000);
          ride.otpAttempts = 0;
          await manager.save(ride);
          return { result: 'locked' as const };
        }
        await manager.save(ride);
        return { result: 'wrong' as const, attemptsLeft: 5 - ride.otpAttempts };
      }

      ride.otpAttempts = 0;
      ride.otpLockedUntil = null;
      ride.status = 'in_progress';
      ride.startedAt = new Date();
      await manager.save(ride);
      return { result: 'ok' as const };
    });

    if (outcome.result === 'locked') {
      throw new HttpException(
        'Too many incorrect OTP attempts. Verification locked for 5 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome.result === 'wrong') {
      throw new BadRequestException(`Incorrect pickup OTP. ${outcome.attemptsLeft} attempts remaining.`);
    }

    const fresh = await this.getOrThrow(rideId);
    // Pass-4 (task 6): soft flag — the driver's fresh ping (> 5 min old is
    // too stale to judge) sits > 1 km from pickup, e.g. the OTP was read
    // out over the phone. Never blocks the trip.
    if (fresh.driverId) {
      const km = await this.driverFreshKmFrom(fresh.driverId, fresh.pickup);
      if (km !== null && km > FLAG_DISTANCE_KM) {
        await this.flagFraud('pickup_far', 'ride', fresh.id, { km: Math.round(km * 10) / 10 });
      }
    }
    this.pushStatus(fresh);
    return this.toDriverView(fresh);
  }

  // PATCH /rides/:id/complete — calculates final fare.
  // R-7: driver-supplied distance is NOT trusted beyond 1.25x the booking
  // estimate, which is the ROUTED distance recorded at booking (2 km absolute
  // floor for short trips, 500 km hard cap). The admin ride detail flags rides
  // whose recorded distance still exceeds 1.5x the routed route, so an
  // inflated claim is visible to review.
  // R-4: the whole transition runs under the row lock (cancel can no longer
  // interleave between the status check and the fare write).
  async complete(rideId: string, driverUserId: string, dto: CompleteRideDto): Promise<any> {
    const { driverId, dropoff, claimedKm, estimateKm } = await this.withRideLock(rideId, async (ride, manager) => {
      await this.assertOwningDriver(ride, driverUserId);

      if (ride.status !== 'in_progress') {
        throw new BadRequestException(`Ride is ${ride.status}, cannot complete`);
      }

      const estimateKm = Number(ride.distanceKm ?? 0);
      let finalDistanceKm = dto.actualDistanceKm ?? estimateKm;
      if (!Number.isFinite(finalDistanceKm) || finalDistanceKm <= 0) {
        throw new BadRequestException('Invalid trip distance');
      }
      // Pass-4 (task 6): the UNCLAMPED distance claim vs the routed distance
      // recorded at booking — drives the distance_inflated soft flag below.
      const claimedKm = finalDistanceKm;
      const clampAt = Math.min(Math.max(estimateKm * 1.25, 2), 500);
      finalDistanceKm = Math.min(finalDistanceKm, clampAt);
      const numericPrice = computeNumericPrice(ride.vehicleType, finalDistanceKm);
      // PR-1: honour the discount recorded ON THE RIDE at booking
      // (fareBreakdown.discount) — not a fresh promo lookup. Re-reading the
      // promo meant an admin editing the amount (or deleting the promo) while
      // the ride was in progress changed the fare the rider had been shown.
      // The live lookup stays only as a fallback for rides with no stored value.
      const storedDiscount = Number(ride.fareBreakdown?.discount);
      const discount = ride.promoCode
        ? Number.isFinite(storedDiscount)
          ? storedDiscount
          : await this.promosService.discountFor(ride.promoCode)
        : 0;
      ride.fareBreakdown = computeFareBreakdown(numericPrice, discount);
      ride.distanceKm = finalDistanceKm.toFixed(2);
      ride.status = 'completed';
      ride.completedAt = new Date();
      await manager.save(ride);
      // PR-1: record the redemption inside the same transaction — the fare,
      // the redemption row and the cap counter commit (or roll back) together.
      if (ride.promoCode) {
        await this.promosService.recordRedemption(ride.promoCode, rideId, ride.riderId, manager);
      }
      return { driverId: ride.driverId!, dropoff: ride.dropoff, claimedKm, estimateKm };
    });

    // PERF: these were four sequential awaits. availability + driver lookup are
    // independent, so run them together; the status push reuses the known
    // driver userId (no second lookup) and the reload skips unused joins.
    const [, driver] = await Promise.all([
      this.drivers.setAvailability(driverId, true),
      this.drivers.findById(driverId),
    ]);
    await this.geo.upsertDriverLocation(
      driver.id,
      driver.vehicleType,
      driver.location?.coordinates[1] ?? dropoff?.lat ?? 0,
      driver.location?.coordinates[0] ?? dropoff?.lng ?? 0,
    );

    // Pass-4 (task 6): soft fraud flags (never block): the driver's fresh
    // last ping sits > 1 km from the dropoff, or the unclamped distance
    // claim is > 1.15x the routed distance recorded at booking (the fare
    // was clamped in the lock above; the flag leaves the trace for review).
    if (dropoff) {
      const km = await this.driverFreshKmFrom(driverId, dropoff);
      if (km !== null && km > FLAG_DISTANCE_KM) {
        await this.flagFraud('dropoff_far', 'ride', rideId, { km: Math.round(km * 10) / 10 });
      }
    }
    if (estimateKm > 0 && claimedKm > estimateKm * 1.15) {
      await this.flagFraud('distance_inflated', 'ride', rideId, {
        claimedKm: Math.round(claimedKm * 100) / 100,
        routedKm: estimateKm,
      });
    }

    const fresh = await this.loadForDriverView(rideId);
    this.pushStatus(fresh, driverUserId);
    return this.toDriverView(fresh);
  }

  // PATCH /rides/:id/payment-received — DriverPaymentScreen's "Amount
  // Received". The rider pays via the UPI QR shown on the driver's phone
  // (outside the app), so the driver confirms collection here; that flag is
  // what the admin console reports. Driver-owned and completed-only.
  // P-1: this is the ONLY rider/driver path that can settle a ride (a rider's
  // own claim only reaches `rider_claimed`), and it records who confirmed.
  async markPaymentReceived(rideId: string, driverUserId: string): Promise<any> {
    // Resolve the driver before the lock (same discipline as accept/decline).
    const driver = await this.drivers.findByUserId(driverUserId);
    // Pass-4 (task 2): the check + write run under the row lock as a
    // conditional update, so the lock-serialised second caller sees `paid`
    // and skips — exactly one transition and exactly one audit row.
    const confirmed = await this.withRideLock(rideId, async (ride, manager) => {
      if (ride.driverId !== driver.id) throw new ForbiddenException('Not your ride');
      if (ride.status !== 'completed') {
        throw new BadRequestException(
          `Ride is ${ride.status}, payment can only be collected after completion`,
        );
      }
      if (ride.paymentStatus === 'disputed') {
        throw new ConflictException('Payment is disputed — only an admin can resolve it');
      }
      if (ride.paymentStatus === 'paid') return false; // idempotent re-tap
      const result = await manager.update(
        RideEntity,
        { id: ride.id, status: 'completed', paymentStatus: ride.paymentStatus },
        { paymentStatus: 'paid', paymentMarkedBy: 'driver' },
      );
      if (!result.affected) return false;
      // Audit INSIDE the same transaction: every driver self-confirmation of
      // a cash fare must be traceable in the admin console.
      await manager.save(AdminAuditLogEntity, {
        actorUserId: driver.userId,
        actorName: null,
        action: 'payment_driver_confirm',
        targetType: 'ride',
        targetId: ride.id,
        meta: { rideId: ride.id, amount: ride.fareBreakdown?.total ?? null },
      });
      return true;
    });
    if (confirmed) {
      // Keep the payment rows consistent with the ride (the admin resolve
      // path already does this). Without it the cash order stayed
      // 'rider_claimed' / 'pending' forever. rides.paymentStatus stays the
      // source of truth, so this is best-effort and never fails the driver's
      // confirmation.
      try {
        await this.rides.manager.update(
          PaymentEntity,
          { rideId, status: In(['pending', 'rider_claimed']) },
          { status: 'paid' },
        );
      } catch (err) {
        this.logger.warn(`Could not sync payment rows for ride ${rideId}: ${(err as Error).message}`);
      }
    }
    // Reload after commit (withRideLock contract) for the driver view.
    const updated = await this.getOrThrow(rideId);
    return this.toDriverView(updated);
  }

  // PATCH /rides/:id/cancel — CancelRideConfirmationScreen.
  // Unified accounts: ownership is inferred from the ride itself, not the
  // (possibly stale) JWT role claim. Rider-side cancel works when
  // ride.riderId matches; driver-side when the caller's driver profile owns
  // ride.driverId. Either party may cancel an assigned ride — except once it
  // is in_progress (SEC-3 below: the rider is locked out, the driver needs a
  // reason and gets flagged for admin review).
  //
  // R-2: the ride row is locked and ownership is verified BEFORE any timer is
  // touched — previously a foreign caller got a 403 but the offer timer had
  // already been cleared, leaving the offered driver stuck offline forever.
  async cancel(rideId: string, userId: string, role: 'rider' | 'driver' | 'admin', dto: CancelRideDto): Promise<any> {
    const queryRunner = this.rides.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let ride!: RideEntity;
    let effectiveRole!: 'rider' | 'driver';
    try {
      const locked = await queryRunner.manager.findOne(RideEntity, {
        where: { id: rideId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Ride not found');
      ride = locked;

      const isRider = ride.riderId === userId;
      let isDriver = false;
      if (!isRider) {
        const driver = await this.drivers.findByUserId(userId).catch(() => null);
        isDriver = !!driver && ride.driverId === driver.id;
      } else if (ride.driverId) {
        // Rider cancelling a ride that already has a driver: still allowed.
        const driver = await this.drivers.findByUserId(userId).catch(() => null);
        if (driver && ride.driverId === driver.id) isDriver = true;
      }
      if (!isRider && !isDriver) {
        throw new ForbiddenException('Not your ride');
      }
      effectiveRole = isDriver && !isRider ? 'driver' : isRider && !isDriver ? 'rider' : role === 'admin' ? 'rider' : role;
      // Double-tap / retry: the SAME party cancelling a ride they already
      // cancelled is a success (idempotent), not a 400. Nothing is written,
      // no timer or driver is touched twice.
      if (ride.status === 'cancelled' && ride.cancelledBy === effectiveRole) {
        await queryRunner.rollbackTransaction().catch(() => {});
        const same = await this.getOrThrow(rideId).catch(() => ride);
        return effectiveRole === 'driver' ? this.toDriverView(same) : this.toRiderView(same);
      }
      if (ride.status === 'completed' || ride.status === 'cancelled') {
        throw new BadRequestException(`Ride is already ${ride.status}`);
      }

      // SEC-3: free-ride bug — a rider could cancel AT the destination once
      // in_progress, paying nothing while the driver's complete() then failed
      // ("Ride is already cancelled"). The rider can no longer end an underway
      // trip through this endpoint; the driver ends it (or support intervenes
      // via the admin cancel, which is unchanged).
      let flaggedForReview = false;
      if (ride.status === 'in_progress') {
        if (effectiveRole === 'rider') {
          throw new ConflictException(
            'This trip is already in progress — ask the driver to end the trip, or contact support to cancel.',
          );
        }
        // Drivers may end an in-progress trip, but only with a stated reason,
        // and the cancel is flagged for admin review (audit row below).
        if (!dto.reason?.trim()) {
          throw new BadRequestException('A reason is required to cancel a trip in progress');
        }
        flaggedForReview = true;
      }

      // Ownership + status both checked: we own this transition now.

      ride.status = 'cancelled';
      ride.cancellationReason = dto.reason;
      ride.cancelledBy = effectiveRole;
      ride.cancelledAt = new Date();
      await queryRunner.manager.save(ride);
      if (flaggedForReview) {
        // Written INSIDE the transaction: a mid-trip driver cancel without a
        // review trail must not be able to commit — the flag IS the control.
        await queryRunner.manager.save(AdminAuditLogEntity, {
          actorUserId: userId,
          actorName: null,
          action: 'ride_cancel',
          targetType: 'ride',
          targetId: rideId,
          reason: dto.reason,
          meta: { cancelledBy: effectiveRole, fromStatus: 'in_progress', flaggedForReview: true },
        });
      }
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => {});
      throw err;
    } finally {
      await queryRunner.release().catch(() => {});
    }

    // SEC-11: the Redis timer clears run only AFTER the commit. They were
    // inside the transaction before — Redis can't roll back with Postgres,
    // so a failed commit left an active ride with no offer/search timer
    // (offered driver stuck, or the search window never auto-cancelling).
    // A rare stale-timer fire on a cancelled ride is safe: every handler
    // re-reads the ride and no-ops unless it is still in the right state.
    // Both clears are bounded (raceTimeout) and run together: a slow Redis
    // must not make a committed cancel hang for seconds.
    await Promise.all([this.clearOfferTimeout(rideId), this.clearSearchTimeout(rideId)]);

    if (ride.driverId) {
      // The cancel is already committed: a hiccup freeing the driver must not
      // turn it into an error for the rider (the stale sweep is the safety net).
      await raceTimeout(this.drivers.setAvailability(ride.driverId, true)).catch((err) =>
        this.logger.error(`Failed to free driver ${ride.driverId} after cancel of ${rideId}: ${(err as Error).message}`),
      );
    }

    // Reload with relations so the response keeps riderName/driver info the
    // un-locked row can't carry.
    const fresh = await this.getOrThrow(rideId).catch(() => ride);
    this.pushStatus(fresh);
    return effectiveRole === 'driver' ? this.toDriverView(fresh) : this.toRiderView(fresh);
  }

  // Matches ReviewRideScreen's onSubmitReview (rating + compliments + tip).
  // One review per ride: a second submit is rejected so ratings/totalTrips
  // cannot be farmed by re-reviewing.
  // SEC-9: the whole check-write-apply runs under the ride row lock. Before,
  // two concurrent submits both read rating == null and both wrote — the
  // ride row kept only the last save, but BOTH applyRating calls landed,
  // rolling the same trip into the driver's running average twice
  // (totalTrips + 2). The lock serializes them: the loser re-reads the
  // committed row and gets the 409.
  async submitReview(rideId: string, riderId: string, dto: SubmitReviewDto): Promise<any> {
    await this.withRideLock(rideId, async (ride, manager) => {
      if (ride.riderId !== riderId) {
        throw new ForbiddenException('Not your ride');
      }
      if (ride.status !== 'completed') {
        throw new BadRequestException('Can only review a completed ride');
      }
      if (ride.rating != null) {
        throw new ConflictException('This ride has already been reviewed');
      }

      ride.rating = dto.rating;
      ride.compliments = dto.compliments ?? [];
      ride.ratingComment = dto.comment?.trim() ? dto.comment.trim() : null;
      ride.tipAmount = dto.tipAmount ?? 0;
      await manager.save(ride);

      if (ride.driverId) {
        // Same transaction: the driver aggregate moves only if the review
        // commits (applyRating's atomic SQL joins the ride write).
        await this.drivers.applyRating(ride.driverId, dto.rating, manager);
      }
    });
    // Reload after commit (withRideLock contract) — relations for the view.
    const fresh = await this.getOrThrow(rideId);
    return this.toRiderView(fresh);
  }

  // GET /rides/:id
  async findById(rideId: string, requesterId: string): Promise<any> {
    const ride = await this.getOrThrow(rideId);
    const driver = ride.driverId ? await this.drivers.findById(ride.driverId).catch(() => null) : null;
    if (ride.riderId !== requesterId && driver?.userId !== requesterId) {
      throw new ForbiddenException('Not your ride');
    }
    if (driver?.userId === requesterId) {
      return this.toDriverView(ride);
    }
    return this.toRiderView(ride);
  }

  // GET /rides (My Rides tab) — history for the current rider or driver.
  // Unified accounts: ?as= explicitly selects the side; otherwise the JWT
  // role is used. Never throws when the driver profile is missing — returns
  // an empty list so the Trips tab shows "No trips yet" instead of an error.
  async list(
    userId: string,
    role: 'rider' | 'driver' | 'admin',
    page = 1,
    limit = 20,
    as?: 'rider' | 'driver',
  ): Promise<{ items: any[]; total: number }> {
    const effective = as ?? (role === 'admin' ? 'rider' : role) ?? 'rider';
    if (effective === 'driver') {
      const driver = await this.drivers
        .findByUserId(userId)
        .catch(() => null);
      if (!driver) return { items: [], total: 0 };
      const [items, total] = await this.rides.findAndCount({
        where: { driverId: driver.id },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
        relations: ['rider', 'driver', 'driver.user'],
      });
      return { items: items.map((r) => this.toDriverView(r)), total };
    }

    const [items, total] = await this.rides.findAndCount({
      where: { riderId: userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['rider', 'driver', 'driver.user'],
    });
    return { items: items.map((r) => this.toRiderView(r)), total };
  }

  private async getOrThrow(rideId: string): Promise<RideEntity> {
    const ride = await this.rides.findOne({
      where: { id: rideId },
      relations: ['rider', 'driver', 'driver.user'],
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    return ride;
  }

  // PERF: the driver-facing response only needs the rider (first name +
  // avatar). getOrThrow() also joins driver + driver.user, which the driver
  // view never reads — a heavier query on every accept/en-route/start.
  private async loadForDriverView(rideId: string): Promise<RideEntity> {
    const ride = await this.rides.findOne({ where: { id: rideId }, relations: ['rider'] });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    return ride;
  }

  private async assertOwningDriver(ride: RideEntity, driverUserId: string): Promise<void> {
    const driver = await this.drivers.findByUserId(driverUserId);
    if (ride.driverId !== driver.id) {
      throw new ForbiddenException('Not your ride');
    }
  }

  // Pass-4 (task 6): soft trip-fraud flags. These NEVER block a trip — they
  // write one `ride_flag` audit row (reason recorded in both the `reason`
  // column and `meta.reason`) that GET /admin/rides/:id surfaces as
  // `flags[]`. Deduplicated per (targetType, targetId, reason) by a
  // best-effort existence check: soft flags don't justify a unique index.
  // Failures are swallowed — a flag write must never affect a trip.
  private async flagFraud(
    reason: 'pickup_far' | 'dropoff_far' | 'distance_inflated' | 'location_jump',
    targetType: 'ride' | 'driver',
    targetId: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const existing = await this.rides.manager.findOne(AdminAuditLogEntity, {
        where: { action: 'ride_flag', targetType, targetId, reason },
      });
      if (existing) return;
      await this.rides.manager.save(AdminAuditLogEntity, {
        actorUserId: null,
        actorName: null,
        action: 'ride_flag',
        targetType,
        targetId,
        reason,
        meta: { reason, ...meta },
      });
    } catch (err) {
      this.logger.warn(
        `fraud flag ${reason} for ${targetType} ${targetId} not recorded: ${(err as Error).message}`,
      );
    }
  }

  // Pass-4 (task 6): the driver's last ping measured against `point`, but
  // only when fresh enough to judge (≤ 5 min old). Null when stale/missing.
  private async driverFreshKmFrom(
    driverId: string,
    point: { lat: number; lng: number },
  ): Promise<number | null> {
    try {
      const driver = await this.drivers.findById(driverId);
      const loc = driver?.location;
      const at = driver?.locationUpdatedAt;
      if (!loc || !at || Date.now() - at.getTime() > FLAG_FRESH_MS) return null;
      return haversineKm({ lat: loc.coordinates[1], lng: loc.coordinates[0] }, point);
    } catch {
      return null;
    }
  }

  // `driverUserId` (optional): callers that already know the driver's user id
  // pass it so we skip the extra drivers.findById() lookup and emit at once.
  private pushStatus(ride: RideEntity, driverUserId?: string): void {
    // Background notification for the rider (deduped per ride+status inside).
    void this.push?.notifyRider(ride);
    if (driverUserId) {
      this.gateway.emitRideStatus(ride.id, ride.riderId, driverUserId, this.toStatusPayload(ride));
      return;
    }
    this.drivers
      .findById(ride.driverId ?? '')
      .then((driver) =>
        this.gateway.emitRideStatus(ride.id, ride.riderId, driver.userId, this.toStatusPayload(ride)),
      )
      .catch(() => this.gateway.emitRideStatus(ride.id, ride.riderId, null, this.toStatusPayload(ride)));
  }

  private toStatusPayload(ride: RideEntity) {
    return {
      rideId: ride.id,
      status: ride.status,
      driverId: ride.driverId,
      pickupOtp: ['requested', 'matched', 'driver_en_route'].includes(ride.status) ? ride.pickupOtp : undefined,
      fareBreakdown: ride.fareBreakdown,
      cancellationReason: ride.cancellationReason,
    };
  }

  // Explicit whitelist of ride fields safe to return to either party.
  // Never spread the entity: it (and its loaded relations) contain phone
  // numbers, refreshTokenHash and driver document paths.
  private rideWhitelist(ride: RideEntity): Record<string, any> {
    return {
      id: ride.id,
      status: ride.status,
      vehicleType: ride.vehicleType,
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      fareBreakdown: ride.fareBreakdown,
      distanceKm: ride.distanceKm ?? null,
      paymentMethod: ride.paymentMethod,
      paymentStatus: ride.paymentStatus,
      driverId: ride.driverId ?? null,
      riderId: ride.riderId,
      rating: ride.rating ?? null,
      tipAmount: ride.tipAmount ?? 0,
      compliments: ride.compliments ?? null,
      cancellationReason: ride.cancellationReason ?? null,
      cancelledBy: ride.cancelledBy ?? null,
      cancelledAt: ride.cancelledAt ?? null,
      completedAt: ride.completedAt ?? null,
      createdAt: ride.createdAt,
      updatedAt: (ride as RideEntity).updatedAt ?? null,
    };
  }

  // Safe subset of the driver for the rider's screens (name/vehicle only —
  // no phone, no document paths). Tolerates both the loaded DriverEntity and
  // an already-whitelisted object (create() converts views twice).
  private buildRiderDriverView(ride: RideEntity): Record<string, any> | null {
    const driver: any = (ride as any).driver;
    if (!driver) return null;
    const name: string | undefined = driver.user?.name ?? driver.name ?? undefined;
    const ratingNum = Number(driver.rating);
    // Last known position so the rider's map can place the driver immediately
    // (live updates then arrive over the socket). Only shared while the driver
    // is heading to the pickup — never before assignment or after the trip
    // starts. Accepts the raw GeoJSON point AND an already-whitelisted
    // {lat,lng} (this view can be built twice, see create()).
    let location: { lat: number; lng: number } | null = null;
    if (ride.status === 'matched' || ride.status === 'driver_en_route') {
      const loc: any = driver.location;
      if (Array.isArray(loc?.coordinates) && loc.coordinates.length === 2) {
        const lng = Number(loc.coordinates[0]);
        const lat = Number(loc.coordinates[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) location = { lat, lng };
      } else if (Number.isFinite(loc?.lat) && Number.isFinite(loc?.lng)) {
        location = { lat: loc.lat, lng: loc.lng };
      }
    }
    return {
      name: name && name.trim() ? name : 'Driver',
      rating: Number.isFinite(ratingNum) ? ratingNum : null,
      vehicleModel: driver.carModel ?? driver.vehicleModel ?? null,
      plateNumber: driver.plateNumber ?? null,
      vehicleType: driver.vehicleType ?? ride.vehicleType ?? null,
      location,
      // Profile photo (Cloudinary https URL, or API-relative local endpoint).
      // Falls back to an already-whitelisted avatar when the view is built
      // twice, so a second pass never wipes it.
      avatar:
        toAvatarUrl(driver.userId, driver.user?.avatar) ??
        (typeof driver.avatar === 'string' ? driver.avatar : null),
    };
  }

  toDriverView(ride: RideEntity): any {
    const base = this.rideWhitelist(ride);
    // Only the rider's first name — nothing else about the user.
    const riderName: unknown = (ride as any).rider?.name;
    if (typeof riderName === 'string' && riderName.trim()) {
      base.riderName = riderName.trim().split(/\s+/)[0];
    }
    // Profile photo shown on the driver's offer / trip cards (idempotent —
    // keeps an already-converted value if the view is built twice).
    const riderAvatar =
      toAvatarUrl(ride.riderId, (ride as any).rider?.avatar) ??
      (typeof (ride as any).riderAvatar === 'string' ? (ride as any).riderAvatar : null);
    if (riderAvatar) base.riderAvatar = riderAvatar;
    return base;
  }

  toRiderView(ride: RideEntity): any {
    const base = this.rideWhitelist(ride);
    // The OTP is only meaningful while the rider still has to share it.
    if (['requested', 'matched', 'driver_en_route'].includes(ride.status)) {
      base.pickupOtp = ride.pickupOtp ?? null;
    }
    base.driver = this.buildRiderDriverView(ride);
    return base;
  }
}
