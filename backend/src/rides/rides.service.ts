import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { In, LessThan, Repository } from 'typeorm';
import { haversineKm } from '../common/geo-utils';
import { DriversService } from '../drivers/drivers.service';
import { GeoService } from '../drivers/geo.service';
import { VehicleType } from '../drivers/entities/driver.entity';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { CompleteRideDto } from './dto/complete-ride.dto';
import { CreateRideDto } from './dto/create-ride.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { VerifyPickupOtpDto } from './dto/verify-pickup-otp.dto';
import { RideEntity } from './entities/ride.entity';
import { computeFareBreakdown, computeNumericPrice } from './fare-catalog';
import { RidesGateway } from './gateway/rides.gateway';
import { PromosService } from '../promos/promos.service';



function generateOtp(length = 4): string {
  // crypto-secure OTP: Math.random is predictable.
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, '0');
}

// Single source of truth for "rider is locked out of booking" statuses.
// Used by create() and findActiveForRider() so they can never drift apart.
export const ACTIVE_RIDE_STATUSES = ['requested', 'matched', 'driver_en_route', 'in_progress'] as const;

@Injectable()
export class RidesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly requestTimeoutSeconds: number;
  private readonly logger = new Logger(RidesService.name);
  private readonly offerTimeouts = new Map<string, NodeJS.Timeout>();
  private staleSweepTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    private readonly drivers: DriversService,
    private readonly geo: GeoService,
    private readonly gateway: RidesGateway,
    private readonly config: ConfigService,
    private readonly promosService: PromosService,
  ) {
    this.requestTimeoutSeconds = this.config.get<number>('RIDE_REQUEST_TIMEOUT_SECONDS') ?? 15;
  }

  // Startup sweep: recover from server restarts so no drivers are permanently reserved
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Running startup sweep for pending requested rides...');
    try {
      const pendingRides = await this.rides.find({
        where: { status: 'requested' },
      });
      const now = Date.now();
      for (const ride of pendingRides) {
        if (ride.driverId && ride.offerExpiresAt && ride.offerExpiresAt.getTime() > now) {
          const remainingMs = ride.offerExpiresAt.getTime() - now;
          this.logger.log(`Re-arming offer timeout for ride ${ride.id} (${remainingMs}ms remaining)`);
          this.scheduleOfferTimeout(ride.id, ride.driverId, remainingMs);
        } else {
          // Expired during server downtime
          if (ride.driverId) {
            await this.drivers.setAvailability(ride.driverId, true).catch(() => {});
            ride.declinedDriverIds = [...(ride.declinedDriverIds || []), ride.driverId];
            ride.driverId = null;
          }
          if ((ride.declinedDriverIds?.length ?? 0) >= 3) {
            ride.status = 'cancelled';
            ride.cancellationReason = 'no_drivers_available';
            ride.cancelledBy = 'system';
            ride.cancelledAt = new Date();
            await this.rides.save(ride);
            this.pushStatus(ride);
          } else {
            await this.rides.save(ride);
            this.matchNearestDriver(ride).catch((err) => {
              this.logger.error(`Startup sweep re-match failed for ride ${ride.id}`, err);
            });
          }
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
  }

  onModuleDestroy(): void {
    if (this.staleSweepTimer) {
      clearInterval(this.staleSweepTimer);
      this.staleSweepTimer = null;
    }
    for (const timer of this.offerTimeouts.values()) {
      clearTimeout(timer);
    }
    this.offerTimeouts.clear();
  }

  // Auto-cancels rides abandoned mid-flow: matched/driver_en_route untouched
  // for 60 minutes, in_progress untouched for 6 hours. Frees the driver and
  // pushes the status so the rider can book again.
  async sweepStaleRides(now = new Date()): Promise<number> {
    const assignedCutoff = new Date(now.getTime() - 60 * 60 * 1000);
    const tripCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const staleAssigned = await this.rides.find({
      where: { status: In(['matched', 'driver_en_route']), updatedAt: LessThan(assignedCutoff) },
    });
    const staleTrips = await this.rides.find({
      where: { status: In(['in_progress']), updatedAt: LessThan(tripCutoff) },
    });
    const stale = [...staleAssigned, ...staleTrips];
    let cancelled = 0;
    for (const ride of stale) {
      try {
        // Captured before mutation so the log shows the real previous status.
        const previousStatus = ride.status;
        // Conditional update: only cancel if the status is still the exact
        // one we judged stale, so a ride that progressed between find() and
        // now (e.g. matched -> driver_en_route) is never touched.
        const result = await this.rides.update(
          { id: ride.id, status: previousStatus },
          {
            status: 'cancelled',
            cancelledBy: 'system',
            cancellationReason: 'stale_ride_timeout',
            cancelledAt: new Date(),
          },
        );
        if (!result.affected) continue;
        ride.status = 'cancelled';
        ride.cancelledBy = 'system';
        ride.cancellationReason = 'stale_ride_timeout';
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

  private clearOfferTimeout(rideId: string): void {
    const timer = this.offerTimeouts.get(rideId);
    if (timer) {
      clearTimeout(timer);
      this.offerTimeouts.delete(rideId);
    }
  }

  private scheduleOfferTimeout(rideId: string, driverId: string, timeoutMs: number): void {
    this.clearOfferTimeout(rideId);
    const timer = setTimeout(async () => {
      this.offerTimeouts.delete(rideId);
      try {
        const ride = await this.rides.findOne({ where: { id: rideId } });
        if (!ride || ride.status !== 'requested' || ride.driverId !== driverId) {
          return;
        }
        this.logger.warn(`Offer timed out for ride ${rideId} with driver ${driverId}`);
        await this.drivers.setAvailability(driverId, true);
        ride.driverId = null;
        ride.declinedDriverIds = [...(ride.declinedDriverIds || []), driverId];
        await this.rides.save(ride);

        if (ride.declinedDriverIds.length >= 3) {
          ride.status = 'cancelled';
          ride.cancellationReason = 'no_drivers_available';
          ride.cancelledBy = 'system';
          ride.cancelledAt = new Date();
          await this.rides.save(ride);
          this.pushStatus(ride);
          this.logger.warn(`Ride ${rideId} cancelled after 3 failed/expired driver offers`);
        } else {
          await this.matchNearestDriver(ride);
        }
      } catch (err) {
        this.logger.error(`Error in offer timeout handler for ride ${rideId}`, err as Error);
      }
    }, timeoutMs);

    this.offerTimeouts.set(rideId, timer);
  }

  // POST /rides — create + trigger nearest-driver matching.
  // Rules: no second active ride as rider; online drivers must go offline
  // first (they cannot book while advertising availability).
  async create(riderId: string, dto: CreateRideDto): Promise<any> {
    const active = await this.rides.count({
      where: { riderId, status: In([...ACTIVE_RIDE_STATUSES]) },
    });
    if (active > 0) {
      throw new BadRequestException('You already have an active ride. Cancel or complete it first.');
    }
    const ownDriver = await this.drivers.findByUserId(riderId).catch(() => null);
    if (ownDriver?.isOnline) {
      throw new BadRequestException('Go offline as a driver before booking a ride.');
    }
    const distanceKm = haversineKm(dto.pickup, dto.dropoff);
    const numericPrice = computeNumericPrice(dto.vehicleType, distanceKm);
    const discount = dto.promoCode ? await this.promosService.resolveDiscount(dto.promoCode, riderId) : 0;
    const fareBreakdown = computeFareBreakdown(numericPrice, discount);
    const pickupOtp = generateOtp();

    let ride = this.rides.create({
      riderId,
      status: 'requested',
      vehicleType: dto.vehicleType,
      pickup: dto.pickup,
      dropoff: dto.dropoff,
      promoCode: dto.promoCode ?? null,
      fareBreakdown,
      distanceKm: distanceKm.toFixed(2),
      paymentMethod: dto.paymentMethod ?? 'upi',
      paymentStatus: 'pending',
      pickupOtp,
      declinedDriverIds: [],
      otpAttempts: 0,
    });
    ride = await this.rides.save(ride);

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
    return {
      ...this.toRiderView(reloaded),
      match: matchResult,
    };
  }

  private async matchNearestDriver(
    ride: RideEntity,
    allowUpgrade = false,
  ): Promise<{ status: 'offered' | 'no_drivers'; candidates: number }> {
    this.clearOfferTimeout(ride.id);

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
        await this.rides.save(ride);
        this.pushStatus(ride);
      }
      return { status: 'no_drivers', candidates: 0 };
    }

    const nearest = candidates[0];
    await this.drivers.setAvailability(nearest.driverId, false);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.requestTimeoutSeconds * 1000);

    ride.driverId = nearest.driverId;
    ride.offeredAt = now;
    ride.offerExpiresAt = expiresAt;
    await this.rides.save(ride);

    const driver = await this.drivers.findById(nearest.driverId);
    const withRider = await this.rides.findOne({ where: { id: ride.id }, relations: ['rider'] });

    this.gateway.emitRideRequestToDriver(driver.userId, {
      rideId: ride.id,
      riderName: withRider?.rider?.name ?? 'Rider',
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      vehicleType: ride.vehicleType,
      fareBreakdown: ride.fareBreakdown,
      distanceKm: ride.distanceKm,
      expiresInSeconds: this.requestTimeoutSeconds,
      offerExpiresAt: expiresAt.toISOString(),
    });

    this.scheduleOfferTimeout(ride.id, nearest.driverId, this.requestTimeoutSeconds * 1000);

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
    const queryRunner = this.rides.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const ride = await queryRunner.manager.findOne(RideEntity, {
        where: { id: rideId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ride) throw new NotFoundException('Ride not found');
      const driver = await this.drivers.findByUserId(driverUserId);

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
      await queryRunner.manager.save(ride);
      await queryRunner.commitTransaction();
      this.clearOfferTimeout(rideId);

      // Reload with relations so the driver view carries riderName.
      const updated = await this.getOrThrow(rideId);
      this.pushStatus(updated);
      return this.toDriverView(updated);
    } catch (err) {
      await queryRunner.rollbackTransaction().catch(() => {});
      throw err;
    } finally {
      await queryRunner.release().catch(() => {});
    }
  }

  // PATCH /rides/:id/decline — driver declines or the 15s timer lapses;
  // re-offer to the next nearest driver. Validated before the timer is
  // cleared so a failed decline keeps the offer alive.
  async decline(rideId: string, driverUserId: string): Promise<any> {
    const ride = await this.getOrThrow(rideId);
    const driver = await this.drivers.findByUserId(driverUserId);

    if (ride.status !== 'requested' || ride.driverId !== driver.id) {
      throw new BadRequestException('Nothing to decline');
    }

    this.clearOfferTimeout(rideId);
    await this.drivers.setAvailability(driver.id, true);
    ride.driverId = null;
    ride.declinedDriverIds = [...(ride.declinedDriverIds || []), driver.id];
    await this.rides.save(ride);
    await this.matchNearestDriver(ride);
    const updated = await this.getOrThrow(rideId);
    return this.toDriverView(updated);
  }

  // Driver begins navigating toward the pickup point (TurnByTurnNavigationScreen).
  async markEnRoute(rideId: string, driverUserId: string): Promise<any> {
    const ride = await this.getOrThrow(rideId);
    await this.assertOwningDriver(ride, driverUserId);

    if (ride.status !== 'matched') {
      throw new BadRequestException(`Ride is ${ride.status}, cannot mark en route`);
    }
    ride.status = 'driver_en_route';
    await this.rides.save(ride);
    this.pushStatus(ride);
    return this.toDriverView(ride);
  }

  // PATCH /rides/:id/start — driver has arrived and is ready to collect the
  // pickup OTP from the rider (DriverEnRouteScreen's "Driver Arrived" action).
  async start(rideId: string, driverUserId: string): Promise<{ ride: any; readyForOtp: true }> {
    const ride = await this.getOrThrow(rideId);
    await this.assertOwningDriver(ride, driverUserId);

    if (ride.status !== 'driver_en_route' && ride.status !== 'matched') {
      throw new BadRequestException(`Ride is ${ride.status}, cannot start pickup`);
    }
    if (ride.status === 'matched') {
      ride.status = 'driver_en_route';
      await this.rides.save(ride);
      this.pushStatus(ride);
    }
    return { ride: this.toDriverView(ride), readyForOtp: true };
  }

  // PATCH /rides/:id/verify-pickup-otp — confirms the code shown on
  // YouGotTheRideScreen; on success the trip formally begins.
  async verifyPickupOtp(rideId: string, driverUserId: string, dto: VerifyPickupOtpDto): Promise<any> {
    const ride = await this.getOrThrow(rideId);
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
        await this.rides.save(ride);
        throw new HttpException(
          'Too many incorrect OTP attempts. Verification locked for 5 minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.rides.save(ride);
      throw new BadRequestException(`Incorrect pickup OTP. ${5 - ride.otpAttempts} attempts remaining.`);
    }

    ride.otpAttempts = 0;
    ride.otpLockedUntil = null;
    ride.status = 'in_progress';
    ride.startedAt = new Date();
    await this.rides.save(ride);
    this.pushStatus(ride);
    return this.toDriverView(ride);
  }

  // PATCH /rides/:id/complete — calculates final fare.
  // Driver-supplied distance is clamped: it may exceed the estimate by at most
  // 3x (detours) and never exceed 500 km (fare bomb guard).
  async complete(rideId: string, driverUserId: string, dto: CompleteRideDto): Promise<any> {
    const ride = await this.getOrThrow(rideId);
    await this.assertOwningDriver(ride, driverUserId);

    if (ride.status !== 'in_progress') {
      throw new BadRequestException(`Ride is ${ride.status}, cannot complete`);
    }

    const estimateKm = Number(ride.distanceKm ?? 0);
    let finalDistanceKm = dto.actualDistanceKm ?? estimateKm;
    if (!Number.isFinite(finalDistanceKm) || finalDistanceKm <= 0) {
      throw new BadRequestException('Invalid trip distance');
    }
    finalDistanceKm = Math.min(finalDistanceKm, Math.max(estimateKm * 3, 5), 500);
    const numericPrice = computeNumericPrice(ride.vehicleType, finalDistanceKm);
    const discount = ride.promoCode ? this.promosService.discountFor(ride.promoCode) : 0;
    ride.fareBreakdown = computeFareBreakdown(numericPrice, discount);
    ride.distanceKm = finalDistanceKm.toFixed(2);
    ride.status = 'completed';
    ride.completedAt = new Date();
    await this.rides.save(ride);

    await this.drivers.setAvailability(ride.driverId!, true);
    const driver = await this.drivers.findById(ride.driverId!);
    await this.geo.upsertDriverLocation(
      driver.id,
      driver.vehicleType,
      driver.location?.coordinates[1] ?? ride.dropoff.lat,
      driver.location?.coordinates[0] ?? ride.dropoff.lng,
    );

    this.pushStatus(ride);
    return this.toDriverView(ride);
  }

  // PATCH /rides/:id/payment-received — DriverPaymentScreen's "Amount
  // Received". The rider pays via the UPI QR shown on the driver's phone
  // (outside the app), so the driver confirms collection here; that flag is
  // what the admin console reports. Driver-owned and completed-only.
  async markPaymentReceived(rideId: string, driverUserId: string): Promise<any> {
    const ride = await this.getOrThrow(rideId);
    await this.assertOwningDriver(ride, driverUserId);
    if (ride.status !== 'completed') {
      throw new BadRequestException(`Ride is ${ride.status}, payment can only be collected after completion`);
    }
    if (ride.paymentStatus !== 'paid') {
      ride.paymentStatus = 'paid';
      await this.rides.save(ride);
    }
    return this.toDriverView(ride);
  }

  // PATCH /rides/:id/cancel — CancelRideConfirmationScreen.
  // Unified accounts: ownership is inferred from the ride itself, not the
  // (possibly stale) JWT role claim. Rider-side cancel works when
  // ride.riderId matches; driver-side when the caller's driver profile owns
  // ride.driverId. Either party may cancel an assigned ride.
  async cancel(rideId: string, userId: string, role: 'rider' | 'driver' | 'admin', dto: CancelRideDto): Promise<any> {
    this.clearOfferTimeout(rideId);
    const ride = await this.getOrThrow(rideId);

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
    const effectiveRole: 'rider' | 'driver' = isDriver && !isRider ? 'driver' : isRider && !isDriver ? 'rider' : role === 'admin' ? 'rider' : role;
    if (ride.status === 'completed' || ride.status === 'cancelled') {
      throw new BadRequestException(`Ride is already ${ride.status}`);
    }

    if (ride.driverId) {
      await this.drivers.setAvailability(ride.driverId, true);
    }

    ride.status = 'cancelled';
    ride.cancellationReason = dto.reason;
    ride.cancelledBy = effectiveRole;
    ride.cancelledAt = new Date();
    await this.rides.save(ride);

    this.pushStatus(ride);
    return effectiveRole === 'driver' ? this.toDriverView(ride) : this.toRiderView(ride);
  }

  // Matches ReviewRideScreen's onSubmitReview (rating + compliments + tip).
  // One review per ride: a second submit is rejected so ratings/totalTrips
  // cannot be farmed by re-reviewing.
  async submitReview(rideId: string, riderId: string, dto: SubmitReviewDto): Promise<any> {
    const ride = await this.getOrThrow(rideId);
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
    ride.tipAmount = dto.tipAmount ?? 0;
    await this.rides.save(ride);

    if (ride.driverId) {
      await this.drivers.applyRating(ride.driverId, dto.rating);
    }
    return this.toRiderView(ride);
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

  private async assertOwningDriver(ride: RideEntity, driverUserId: string): Promise<void> {
    const driver = await this.drivers.findByUserId(driverUserId);
    if (ride.driverId !== driver.id) {
      throw new ForbiddenException('Not your ride');
    }
  }

  private pushStatus(ride: RideEntity): void {
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
    return {
      name: name && name.trim() ? name : 'Driver',
      rating: Number.isFinite(ratingNum) ? ratingNum : null,
      vehicleModel: driver.carModel ?? driver.vehicleModel ?? null,
      plateNumber: driver.plateNumber ?? null,
      vehicleType: driver.vehicleType ?? ride.vehicleType ?? null,
    };
  }

  toDriverView(ride: RideEntity): any {
    const base = this.rideWhitelist(ride);
    // Only the rider's first name — nothing else about the user.
    const riderName: unknown = (ride as any).rider?.name;
    if (typeof riderName === 'string' && riderName.trim()) {
      base.riderName = riderName.trim().split(/\s+/)[0];
    }
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
