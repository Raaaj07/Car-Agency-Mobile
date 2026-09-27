import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { haversineKm } from '../common/geo-utils';
import { DriversService } from '../drivers/drivers.service';
import { GeoService } from '../drivers/geo.service';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { CompleteRideDto } from './dto/complete-ride.dto';
import { CreateRideDto } from './dto/create-ride.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { VerifyPickupOtpDto } from './dto/verify-pickup-otp.dto';
import { RideEntity } from './entities/ride.entity';
import { computeFareBreakdown, computeNumericPrice } from './fare-catalog';
import { RidesGateway } from './gateway/rides.gateway';

const PROMO_CODES: Record<string, number> = {
  VAZHI20: 40, // matches rideStore.applyPromoCode's exact VAZHI20 -> 40 rule
};
const DEFAULT_PROMO_DISCOUNT = 20; // any other code, per the frontend's else branch

function generateOtp(length = 4): string {
  const max = 10 ** length;
  return Math.floor(Math.random() * max).toString().padStart(length, '0');
}

@Injectable()
export class RidesService {
  private readonly requestTimeoutSeconds: number;

  constructor(
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    private readonly drivers: DriversService,
    private readonly geo: GeoService,
    private readonly gateway: RidesGateway,
    private readonly config: ConfigService,
  ) {
    this.requestTimeoutSeconds = this.config.get<number>('RIDE_REQUEST_TIMEOUT_SECONDS') ?? 15;
  }

  // POST /rides — create + trigger nearest-driver matching.
  async create(riderId: string, dto: CreateRideDto): Promise<RideEntity> {
    const distanceKm = haversineKm(dto.pickup, dto.dropoff);
    const numericPrice = computeNumericPrice(dto.vehicleType, distanceKm);
    const discount = this.resolveDiscount(dto.promoCode);
    const fareBreakdown = computeFareBreakdown(numericPrice, discount);

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
    });
    ride = await this.rides.save(ride);

    await this.matchNearestDriver(ride);
    return this.findById(ride.id, riderId);
  }

  private resolveDiscount(promoCode?: string): number {
    if (!promoCode) return 0;
    return PROMO_CODES[promoCode.toUpperCase()] ?? DEFAULT_PROMO_DISCOUNT;
  }

  /**
   * FindingDriverScreen's search: reserve the nearest available driver for
   * this vehicle type (so two riders can't be offered the same driver) and
   * push a ride:request event to them. The ride stays 'requested' until
   * they accept — RideRequestNearbyScreen's own 15s countdown (mirrored by
   * RIDE_REQUEST_TIMEOUT_SECONDS) governs how long they have to respond.
   */
  private async matchNearestDriver(ride: RideEntity): Promise<void> {
    const candidates = await this.drivers.findNearby(
      ride.pickup.lat,
      ride.pickup.lng,
      undefined,
      ride.vehicleType,
    );
    if (candidates.length === 0) return;

    const nearest = candidates[0];
    await this.drivers.setAvailability(nearest.driverId, false);
    await this.rides.update({ id: ride.id }, { driverId: nearest.driverId });

    const driver = await this.drivers.findById(nearest.driverId);
    this.gateway.emitRideRequestToDriver(driver.userId, {
      rideId: ride.id,
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      vehicleType: ride.vehicleType,
      fareBreakdown: ride.fareBreakdown,
      distanceKm: ride.distanceKm,
      expiresInSeconds: this.requestTimeoutSeconds,
    });
  }

  // PATCH /rides/:id/accept — driver accepts (RideRequestNearbyScreen).
  async accept(rideId: string, driverUserId: string): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);
    const driver = await this.drivers.findByUserId(driverUserId);

    if (ride.status !== 'requested') {
      throw new BadRequestException(`Ride is ${ride.status}, cannot accept`);
    }
    if (ride.driverId !== driver.id) {
      throw new ForbiddenException('This ride was not offered to you');
    }

    ride.status = 'matched';
    ride.pickupOtp = generateOtp();
    ride.matchedAt = new Date();
    await this.rides.save(ride);

    this.pushStatus(ride);
    return this.findById(rideId, ride.riderId);
  }

  // PATCH /rides/:id/decline — driver declines or the 15s timer lapses;
  // re-offer to the next nearest driver.
  async decline(rideId: string, driverUserId: string): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);
    const driver = await this.drivers.findByUserId(driverUserId);

    if (ride.status !== 'requested' || ride.driverId !== driver.id) {
      throw new BadRequestException('Nothing to decline');
    }

    await this.drivers.setAvailability(driver.id, true);
    ride.driverId = null;
    await this.rides.save(ride);
    await this.matchNearestDriver(ride);
    return this.getOrThrow(rideId);
  }

  // Driver begins navigating toward the pickup point (TurnByTurnNavigationScreen).
  async markEnRoute(rideId: string, driverUserId: string): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);
    await this.assertOwningDriver(ride, driverUserId);

    if (ride.status !== 'matched') {
      throw new BadRequestException(`Ride is ${ride.status}, cannot mark en route`);
    }
    ride.status = 'driver_en_route';
    await this.rides.save(ride);
    this.pushStatus(ride);
    return ride;
  }

  // PATCH /rides/:id/start — driver has arrived and is ready to collect the
  // pickup OTP from the rider (DriverEnRouteScreen's "Driver Arrived" action).
  async start(rideId: string, driverUserId: string): Promise<{ ride: RideEntity; readyForOtp: true }> {
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
    return { ride, readyForOtp: true };
  }

  // PATCH /rides/:id/verify-pickup-otp — confirms the code shown on
  // YouGotTheRideScreen; on success the trip formally begins.
  async verifyPickupOtp(rideId: string, driverUserId: string, dto: VerifyPickupOtpDto): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);
    await this.assertOwningDriver(ride, driverUserId);

    if (ride.status !== 'driver_en_route') {
      throw new BadRequestException(`Ride is ${ride.status}, cannot verify pickup OTP`);
    }
    if (ride.pickupOtp !== dto.otp) {
      throw new BadRequestException('Incorrect pickup OTP');
    }

    ride.status = 'in_progress';
    ride.startedAt = new Date();
    await this.rides.save(ride);
    this.pushStatus(ride);
    return ride;
  }

  // PATCH /rides/:id/complete — calculates final fare.
  async complete(rideId: string, driverUserId: string, dto: CompleteRideDto): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);
    await this.assertOwningDriver(ride, driverUserId);

    if (ride.status !== 'in_progress') {
      throw new BadRequestException(`Ride is ${ride.status}, cannot complete`);
    }

    const finalDistanceKm = dto.actualDistanceKm ?? Number(ride.distanceKm ?? 0);
    const numericPrice = computeNumericPrice(ride.vehicleType, finalDistanceKm);
    const discount = this.resolveDiscount(ride.promoCode ?? undefined);
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
    return ride;
  }

  // PATCH /rides/:id/cancel — CancelRideConfirmationScreen.
  async cancel(rideId: string, userId: string, role: 'rider' | 'driver', dto: CancelRideDto): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);

    if (role === 'rider' && ride.riderId !== userId) {
      throw new ForbiddenException('Not your ride');
    }
    if (role === 'driver') {
      await this.assertOwningDriver(ride, userId);
    }
    if (ride.status === 'completed' || ride.status === 'cancelled') {
      throw new BadRequestException(`Ride is already ${ride.status}`);
    }

    if (ride.driverId) {
      await this.drivers.setAvailability(ride.driverId, true);
    }

    ride.status = 'cancelled';
    ride.cancellationReason = dto.reason;
    ride.cancelledBy = role;
    ride.cancelledAt = new Date();
    await this.rides.save(ride);

    this.pushStatus(ride);
    return ride;
  }

  // Matches ReviewRideScreen's onSubmitReview (rating + compliments + tip).
  async submitReview(rideId: string, riderId: string, dto: SubmitReviewDto): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);
    if (ride.riderId !== riderId) {
      throw new ForbiddenException('Not your ride');
    }
    if (ride.status !== 'completed') {
      throw new BadRequestException('Can only review a completed ride');
    }

    ride.rating = dto.rating;
    ride.compliments = dto.compliments ?? [];
    ride.tipAmount = dto.tipAmount ?? 0;
    await this.rides.save(ride);

    if (ride.driverId) {
      await this.drivers.applyRating(ride.driverId, dto.rating);
    }
    return ride;
  }

  // GET /rides/:id
  async findById(rideId: string, requesterId: string): Promise<RideEntity> {
    const ride = await this.getOrThrow(rideId);
    const driver = ride.driverId ? await this.drivers.findById(ride.driverId).catch(() => null) : null;
    if (ride.riderId !== requesterId && driver?.userId !== requesterId) {
      throw new ForbiddenException('Not your ride');
    }
    return ride;
  }

  // GET /rides (My Rides tab) — history for the current rider or driver.
  async list(userId: string, role: 'rider' | 'driver', page = 1, limit = 20): Promise<{ items: RideEntity[]; total: number }> {
    const where = role === 'rider' ? { riderId: userId } : {};
    let driverId: string | undefined;
    if (role === 'driver') {
      const driver = await this.drivers.findByUserId(userId);
      driverId = driver.id;
    }

    const [items, total] = await this.rides.findAndCount({
      where: driverId ? { driverId } : where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  private async getOrThrow(rideId: string): Promise<RideEntity> {
    const ride = await this.rides.findOne({ where: { id: rideId } });
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
      pickupOtp: ride.status === 'matched' || ride.status === 'driver_en_route' ? ride.pickupOtp : undefined,
      fareBreakdown: ride.fareBreakdown,
      cancellationReason: ride.cancellationReason,
    };
  }
}
