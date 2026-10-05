import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { GeoService } from '../drivers/geo.service';
import { DocumentAccess, StorageService } from '../drivers/storage.service';
import { RidesGateway } from '../rides/gateway/rides.gateway';
import { PaymentStatus, RideEntity, RideStatus } from '../rides/entities/ride.entity';
import { PaymentEntity } from '../payments/entities/payment.entity';
import { RidesService } from '../rides/rides.service';
import { appTimezone, zonedStartOfDay, zonedStartOfDayAgo } from '../common/timezone';
import { RouteDistanceService } from '../rides/route-distance.service';
import { AdminAuditService } from './admin-audit.service';

type AppStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

// Whitelists for comma-separated list filters (Rides console chips).
const RIDE_STATUS_VALUES: RideStatus[] = [
  'requested',
  'matched',
  'driver_en_route',
  'in_progress',
  'completed',
  'cancelled',
];
const PAYMENT_STATUS_VALUES: PaymentStatus[] = ['pending', 'rider_claimed', 'paid', 'disputed', 'failed'];

/** Ride list/detail never expose raw phone numbers — only this masked form. */
function maskPhone(phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 5) return '•'.repeat(digits.length);
  return `${digits.slice(0, 3)}•••••${digits.slice(-2)}`;
}

@Injectable()
export class AdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    private readonly geo: GeoService,
    private readonly storage: StorageService,
    private readonly gateway: RidesGateway,
    private readonly config: ConfigService,
    private readonly audit: AdminAuditService,
    private readonly ridesSvc: RidesService,
    private readonly routes: RouteDistanceService,
  ) {}

  // First admin(s) come from env, never from a public endpoint.
  // Matches on trailing-10-digit forms so "+91..." entries still match.
  async onApplicationBootstrap(): Promise<void> {
    const raw = this.config.get<string>('ADMIN_PHONES') ?? '';
    const want = raw.split(',').map((s) => s.replace(/\D/g, '').slice(-10)).filter((s) => s.length === 10);
    if (want.length === 0) return;
    for (const digits of want) {
      const user = await this.users
        .createQueryBuilder('u')
        .where('RIGHT(REGEXP_REPLACE(u.phone, \'\\D\', \'\', \'g\'), 10) = :digits', { digits })
        .getOne()
        .catch(() => null);
      if (user && (user.role as string) !== 'admin') {
        await this.users.update({ id: user.id }, { role: 'admin' as any }).catch(() => {});
        this.logger.log(`Promoted ${user.phone} to admin via ADMIN_PHONES`);
      }
    }
  }

  private requireStatus(v: unknown): v is AppStatus {
    return v === 'pending' || v === 'approved' || v === 'rejected' || v === 'suspended';
  }

  async listApplications(
    status?: string,
    page = 1,
    limit = 20,
    opts?: { q?: string; sort?: 'oldest' | 'newest' },
  ) {
    // A-16: clamp once, at the top — skip/take always use the same numbers.
    const lim = Math.min(Math.max(limit || 20, 1), 100);
    const pg = Math.max(page || 1, 1);

    const qb = this.drivers.createQueryBuilder('d').leftJoinAndSelect('d.user', 'u');
    if (status && this.requireStatus(status)) qb.andWhere('d.status = :status', { status });

    const q = (opts?.q ?? '').trim();
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      qb.andWhere(
        `(u.name ILIKE :q ESCAPE '\\' OR u.phone ILIKE :q ESCAPE '\\' OR d."plateNumber" ILIKE :q ESCAPE '\\' OR d."carModel" ILIKE :q ESCAPE '\\')`,
        { q: pattern },
      );
    }

    // A-10: the queue is ordered by submittedAt (oldest waiter first for the
    // pending list) — `updatedAt` reshuffled whenever anyone touched a row.
    const sort = opts?.sort ?? (status === 'pending' ? 'oldest' : 'newest');
    // Order by a selected alias, not a raw expression: with skip/take TypeORM
    // splits order keys on '.', which mangled COALESCE(d."submittedAt", ...)
    // into a bogus alias ("COALESCE(d" alias was not found).
    qb.addSelect('COALESCE(d."submittedAt", d."createdAt")', 'queue_at')
      .orderBy('queue_at', sort === 'oldest' ? 'ASC' : 'DESC')
      .addOrderBy('d.id', 'ASC')
      .skip((pg - 1) * lim)
      .take(lim);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((d) => this.toApplicationSummary(d)),
      total,
      page: pg,
      limit: lim,
    };
  }

  /** GET /admin/driver-applications/counts — segmented-control badges. */
  async listApplicationCounts(): Promise<Record<AppStatus, number> & { total: number }> {
    const rows: Array<{ status: string; count: string }> = await this.drivers
      .createQueryBuilder('d')
      .select('d.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('d.status')
      .getRawMany();
    const out = { pending: 0, approved: 0, rejected: 0, suspended: 0, total: 0 };
    for (const row of rows) {
      const n = Number(row.count ?? 0);
      if (row.status === 'pending' || row.status === 'approved' || row.status === 'rejected' || row.status === 'suspended') {
        out[row.status] = n;
      }
      out.total += n;
    }
    return out;
  }

  private toApplicationSummary(d: DriverEntity) {
    const u = d.user;
    const submittedAt = d.submittedAt ?? d.createdAt;
    return {
      id: d.id,
      userId: d.userId,
      applicantName: u?.name ?? 'Unknown',
      phone: u?.phone ?? '',
      avatar: u?.avatar ?? null,
      status: d.status,
      vehicleType: d.vehicleType,
      carModel: d.carModel,
      plateNumber: d.plateNumber,
      licenseNumber: d.drivingLicenceNumber ?? null,
      submittedAt,
      reviewedAt: d.reviewedAt ?? null,
      // Spec §3.2: list rows show rating/trips + an online dot for active
      // drivers — plain entity columns, no extra queries.
      rating: Number(d.rating),
      totalTrips: d.totalTrips,
      isOnline: d.isOnline,
    };
  }

  /**
   * GET /admin/drivers/:id — one driver: application/profile header, live
   * stats, last 10 rides and the full review history (A-12: history is read
   * from the audit log, so re-applying never erases it).
   */
  async getDriverDetail(id: string) {
    const application = await this.getApplication(id);
    const d = await this.drivers.findOne({ where: { id }, relations: ['user'] }).catch(() => null);
    if (!d) throw new NotFoundException('Driver not found');
    const u = d.user;

    // Reviewer display name (a UUID on the row is not human-readable).
    const reviewerId = d.reviewedByUserId ?? null;
    const reviewer = reviewerId
      ? await this.users.findOne({ where: { id: reviewerId } }).catch(() => null)
      : null;

    // Today's earnings/trips use the operator's day boundary (R-6) and tips.
    const startOfToday = zonedStartOfDay(new Date(), appTimezone(this.config));
    const today = await this.rides
      .createQueryBuilder('ride')
      .select(`COALESCE(SUM((ride."fareBreakdown"->>'total')::numeric), 0)`, 'sum')
      .addSelect(`COALESCE(SUM(ride."tipAmount"), 0)`, 'tip')
      .addSelect('COUNT(*)', 'count')
      .where('ride.driverId = :driverId', { driverId: d.id })
      .andWhere('ride.status = :status', { status: 'completed' })
      .andWhere('ride.completedAt >= :start', { start: startOfToday })
      .getRawOne();

    const lastRidesRaw = await this.rides.find({
      where: { driverId: d.id },
      order: { createdAt: 'DESC' },
      take: 10,
      relations: ['rider'],
    });

    const history = await this.audit.historyForDriver(d.id, 50);

    return {
      ...application,
      avatar: u?.avatar ?? null,
      email: u?.email ?? null,
      isActive: u ? u.isActive !== false : null,
      reviewerName: reviewer?.name ?? null,
      approvedAt: d.approvedAt ?? null,
      stats: {
        rating: Number(d.rating),
        totalTrips: d.totalTrips,
        todayEarnings: Number(today?.sum ?? 0) + Number(today?.tip ?? 0),
        todayTrips: Number(today?.count ?? 0),
        isOnline: d.isOnline,
        isAvailable: d.isAvailable,
        lastLocationAt: d.locationUpdatedAt ?? null,
      },
      lastRides: lastRidesRaw.map((r) => this.toRideSummary(r)),
      history,
    };
  }

  async getApplication(id: string) {
    const d = (await this.drivers.findOne({ where: { id }, relations: ['user'] }).catch(() => null)) as any;
    if (!d) throw new NotFoundException('Application not found');
    return {
      id: d.id,
      userId: d.userId,
      applicantName: d.user?.name ?? 'Unknown',
      phone: d.user?.phone ?? '',
      email: d.user?.email ?? null,
      status: d.status,
      rejectionReason: d.rejectionReason ?? null,
      vehicleType: d.vehicleType,
      carModel: d.carModel,
      plateNumber: d.plateNumber,
      licenseNumber: d.drivingLicenceNumber ?? null,
      rcNumber: d.rcNumber ?? null,
      submittedAt: d.submittedAt ?? d.createdAt,
      reviewedAt: d.reviewedAt ?? null,
      reviewedByUserId: d.reviewedByUserId ?? null,
      hasLicenseImage: !!(d.licenseImagePath || d.drivingLicenceImageUrl),
      hasRcImage: !!(d.rcImagePath || d.rcImageUrl),
      hasVehiclePhoto: !!(d.vehiclePhotoPath || d.carImageUrl),
    };
  }

  async approve(id: string, reviewerId: string) {
    const d = (await this.drivers.findOne({ where: { id } })) as any;
    if (!d) throw new NotFoundException('Application not found');
    if (d.status === 'approved') return this.getApplication(id); // idempotent
    if (d.status !== 'pending' && d.status !== 'rejected') {
      throw new ConflictException(`Cannot approve from status ${d.status}`);
    }
    const previousStatus: AppStatus = d.status;
    d.status = 'approved';
    d.rejectionReason = null;
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    // A-2: reinstate is only legal while approvedAt is set — stamp it here.
    d.approvedAt = new Date();
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'approved' });
    await this.audit.log({
      actorUserId: reviewerId,
      action: 'approve',
      targetType: 'driver',
      targetId: d.id,
      meta: { previousStatus },
    });
    return this.getApplication(id);
  }

  async reject(id: string, reviewerId: string, reason: string) {
    const r = (reason ?? '').trim();
    if (r.length < 5 || r.length > 300) {
      throw new BadRequestException('Rejection reason is required (5–300 characters)');
    }
    const d = (await this.drivers.findOne({ where: { id } })) as any;
    if (!d) throw new NotFoundException('Application not found');
    if (d.status === 'rejected' && d.rejectionReason === r) return this.getApplication(id); // idempotent
    if (d.status !== 'pending' && d.status !== 'rejected') {
      throw new ConflictException(`Cannot reject from status ${d.status}`);
    }
    const previousStatus: AppStatus = d.status;
    d.status = 'rejected';
    d.rejectionReason = r;
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    await this.forceOffline(d);
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'rejected', reason: r });
    await this.audit.log({
      actorUserId: reviewerId,
      action: 'reject',
      targetType: 'driver',
      targetId: d.id,
      reason: r,
      meta: { previousStatus },
    });
    return this.getApplication(id);
  }

  // A-3: suspending a driver mid-trip would orphan the rider. Default: 409
  // carrying the ride id; `{ force: true }` cancels that ride first
  // (cancelledBy='admin', rider gets the status push), then suspends.
  // Every suspension carries an audited reason (A-12).
  async suspend(id: string, reviewerId: string, opts: { reason: string; force?: boolean }) {
    const reason = (opts?.reason ?? '').trim();
    if (reason.length < 5 || reason.length > 300) {
      throw new BadRequestException('Suspension reason is required (5–300 characters)');
    }
    const d = (await this.drivers.findOne({ where: { id } })) as any;
    if (!d) throw new NotFoundException('Driver not found');
    if (d.status === 'suspended') return this.getApplication(id); // idempotent
    // A-2: only an approved driver may be suspended — pending → suspend →
    // reinstate used to be a backdoor approval with zero document review.
    if (d.status !== 'approved') {
      throw new ConflictException(`Cannot suspend from status ${d.status} — only approved drivers can be suspended`);
    }
    const activeRide = await this.rides.findOne({
      where: { driverId: d.id, status: In(AdminService.ACTIVE_RIDE_STATUSES) },
    });
    if (activeRide) {
      if (!opts?.force) {
        throw new ConflictException({
          message: 'Driver has an active ride; retry with { force: true } to cancel it before suspending',
          rideId: activeRide.id,
        });
      }
      await this.cancelRideForAdmin(activeRide.id, `Driver suspended by admin: ${reason}`.slice(0, 200));
    }
    d.status = 'suspended';
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    await this.forceOffline(d);
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'suspended' });
    await this.audit.log({
      actorUserId: reviewerId,
      action: 'suspend',
      targetType: 'driver',
      targetId: d.id,
      reason,
      meta: { previousStatus: 'approved' as AppStatus, forceCancelledRideId: activeRide?.id ?? null },
    });
    return this.getApplication(id);
  }

  async reinstate(id: string, reviewerId: string, opts?: { reason?: string }) {
    const d = (await this.drivers.findOne({ where: { id } })) as any;
    if (!d) throw new NotFoundException('Driver not found');
    if (d.status === 'approved') return this.getApplication(id); // idempotent
    if (d.status !== 'suspended') {
      throw new ConflictException(`Cannot reinstate from status ${d.status}`);
    }
    // A-2: a driver who was never approved must go through document review —
    // reinstating them would be an approval with zero review.
    if (!d.approvedAt) {
      throw new ConflictException('Driver was never approved — use approve/reject after document review instead');
    }
    d.status = 'approved';
    d.rejectionReason = null;
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'approved' });
    await this.audit.log({
      actorUserId: reviewerId,
      action: 'reinstate',
      targetType: 'driver',
      targetId: d.id,
      reason: opts?.reason?.trim() || null,
      meta: { previousStatus: 'suspended' as AppStatus },
    });
    return this.getApplication(id);
  }

  private static readonly ACTIVE_RIDE_STATUSES = ['matched', 'driver_en_route', 'in_progress'] as const;
  // Overview "needs attention": a ride stuck this long in requested/matched.
  private static readonly STUCK_RIDE_MINUTES = 10;

  /**
   * Cancels an active ride on behalf of an admin action (A-3 force-suspend;
   * admin ride cancel reuses this). Frees the driver's availability without
   * touching their online flag, drops any pending offer/search timers, and
   * pushes the status so the rider isn't left hanging.
   */
  async cancelRideForAdmin(rideId: string, reason: string): Promise<void> {
    const ride = await this.rides.findOne({ where: { id: rideId } });
    if (!ride || ride.status === 'completed' || ride.status === 'cancelled') return;
    const result = await this.rides.update(
      { id: ride.id, status: ride.status },
      {
        status: 'cancelled',
        cancelledBy: 'admin',
        cancellationReason: reason.slice(0, 200),
        cancelledAt: new Date(),
      },
    );
    if (!result.affected) return;
    // We own this transition now — only now drop the shared Redis timers so
    // an offered driver isn't left reserved (same discipline as R-2).
    await this.ridesSvc.clearPendingTimers(ride.id);
    ride.status = 'cancelled';
    ride.cancelledBy = 'admin';
    ride.cancellationReason = reason.slice(0, 200);
    ride.cancelledAt = new Date();
    const payload = {
      rideId: ride.id,
      status: ride.status,
      driverId: null,
      cancellationReason: ride.cancellationReason,
    };
    if (ride.driverId) {
      await this.drivers.update({ id: ride.driverId }, { isAvailable: true }).catch(() => {});
      const driver = await this.drivers.findOne({ where: { id: ride.driverId } }).catch(() => null);
      if (driver) {
        this.gateway.emitRideStatus(ride.id, ride.riderId, driver.userId, payload);
        return;
      }
    }
    this.gateway.emitRideStatus(ride.id, ride.riderId, null, payload);
  }

  /**
   * POST /admin/rides/:id/cancel — admin-initiated cancellation of any
   * non-terminal ride; audited and live-pushed to the rider/driver.
   */
  async adminCancelRide(id: string, actorUserId: string, reason: string) {
    const r = (reason ?? '').trim();
    if (r.length < 5 || r.length > 300) {
      throw new BadRequestException('Cancel reason is required (5–300 characters)');
    }
    const ride = await this.rides.findOne({ where: { id } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.status === 'completed' || ride.status === 'cancelled') {
      throw new ConflictException(`Ride is already ${ride.status}`);
    }
    const previousStatus: RideStatus = ride.status;
    await this.cancelRideForAdmin(ride.id, r);
    await this.audit.log({
      actorUserId,
      action: 'ride_cancel',
      targetType: 'ride',
      targetId: ride.id,
      reason: r,
      meta: { previousStatus },
    });
    return {
      id: ride.id,
      status: 'cancelled' as const,
      cancelledBy: 'admin' as const,
      cancellationReason: r.slice(0, 200),
      previousStatus,
    };
  }

  /**
   * POST /admin/rides/:id/payment — the admin's payment resolution (P-1).
   * `paid` settles the ride with paymentMarkedBy='admin' and flips the
   * payment rows; `disputed` flags not-yet-settled rows for follow-up. A
   * disputed state can also be resolved back to paid (chargeback resolved).
   */
  async resolvePayment(id: string, actorUserId: string, status: 'paid' | 'disputed', note: string) {
    const n = (note ?? '').trim();
    if (n.length < 5 || n.length > 300) {
      throw new BadRequestException('Resolution note is required (5–300 characters)');
    }
    const ride = await this.rides.findOne({ where: { id } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.status !== 'completed' && ride.status !== 'cancelled') {
      throw new ConflictException('Payment can only be resolved once the ride has finished');
    }
    const previousStatus: PaymentStatus = ride.paymentStatus;
    const previousMarkedBy = ride.paymentMarkedBy ?? null;
    await this.rides.update(
      { id: ride.id },
      { paymentStatus: status, paymentMarkedBy: 'admin' },
    );
    if (status === 'paid') {
      await this.payments.update({ rideId: ride.id }, { status: 'paid' }).catch(() => {});
    } else {
      // Never downgrade an already-settled gateway row.
      await this.payments
        .update({ rideId: ride.id, status: In(['pending', 'rider_claimed', 'failed']) }, { status: 'disputed' })
        .catch(() => {});
    }
    await this.audit.log({
      actorUserId,
      action: 'payment_resolve',
      targetType: 'ride',
      targetId: ride.id,
      reason: n,
      meta: { paymentStatus: status, previousStatus, previousMarkedBy },
    });
    return {
      id: ride.id,
      paymentStatus: status,
      paymentMarkedBy: 'admin' as const,
      previousStatus,
      previousMarkedBy,
    };
  }

  /** Validates a comma-separated filter against a whitelist (400 on unknown). */
  private parseFilterList<T extends string>(raw: string, allowed: readonly T[], label: string): T[] {
    const values = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean) as T[];
    if (values.length === 0) {
      throw new BadRequestException(`Invalid ${label} filter`);
    }
    const invalid = values.filter((v) => !allowed.includes(v));
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid ${label} filter: ${invalid.join(', ')}`);
    }
    return values;
  }

  /** Whitelisted ride row for every list surface (never phones, never entities). */
  private toRideSummary(r: RideEntity) {
    return {
      id: r.id,
      status: r.status,
      vehicleType: r.vehicleType,
      riderId: r.riderId,
      riderName: r.rider?.name ?? 'Rider',
      driverId: r.driverId ?? null,
      driverName: r.driver?.user?.name ?? 'Unassigned',
      pickupAddress: r.pickup?.address ?? '',
      dropoffAddress: r.dropoff?.address ?? '',
      fareTotal: Number(r.fareBreakdown?.total ?? 0),
      tipAmount: Number(r.tipAmount ?? 0),
      paymentStatus: r.paymentStatus ?? ('pending' as PaymentStatus),
      paymentMarkedBy: r.paymentMarkedBy ?? null,
      paymentMethod: r.paymentMethod ?? 'upi',
      createdAt: r.createdAt,
      completedAt: r.completedAt ?? null,
      cancelledAt: r.cancelledAt ?? null,
      cancelledBy: r.cancelledBy ?? null,
    };
  }

  // GET /admin/rides — filters (status/payment/date/search) + pagination.
  // `status` / `paymentStatus` accept comma-separated groups ("Active" and
  // "Unpaid" chips). Response exposes names/addresses/fare/payment flags only
  // — phone numbers are never returned in ride lists (nor matched by `q`).
  async listRides(filters: {
    status?: string;
    paymentStatus?: string;
    from?: string;
    to?: string;
    q?: string;
    driverId?: string;
    riderId?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const lim = Math.min(Math.max(filters.limit || 20, 1), 100); // A-16: clamp once
    const pg = Math.max(filters.page || 1, 1);

    const qb = this.rides
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.rider', 'rider')
      .leftJoinAndSelect('r.driver', 'driver')
      .leftJoinAndSelect('driver.user', 'driverUser');

    if (filters.status) {
      qb.andWhere('r.status IN (:...statuses)', {
        statuses: this.parseFilterList(filters.status, RIDE_STATUS_VALUES, 'status'),
      });
    }
    if (filters.paymentStatus) {
      qb.andWhere('r.paymentStatus IN (:...paymentStatuses)', {
        paymentStatuses: this.parseFilterList(filters.paymentStatus, PAYMENT_STATUS_VALUES, 'paymentStatus'),
      });
    }
    if (filters.from) qb.andWhere('r.createdAt >= :from', { from: new Date(filters.from) });
    if (filters.to) qb.andWhere('r.createdAt <= :to', { to: new Date(filters.to) });
    if (filters.driverId) qb.andWhere('r.driverId = :driverId', { driverId: filters.driverId });
    if (filters.riderId) qb.andWhere('r.riderId = :riderId', { riderId: filters.riderId });
    const q = (filters.q ?? '').trim();
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      qb.andWhere(
        `(r.id::text ILIKE :q ESCAPE '\\' OR rider.name ILIKE :q ESCAPE '\\' OR driverUser.name ILIKE :q ESCAPE '\\' OR COALESCE(driver."plateNumber", '') ILIKE :q ESCAPE '\\')`,
        { q: pattern },
      );
    }

    qb.orderBy('r.createdAt', 'DESC').addOrderBy('r.id', 'ASC').skip((pg - 1) * lim).take(lim);
    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((r) => this.toRideSummary(r)),
      total,
      page: pg,
      limit: lim,
    };
  }

  /**
   * GET /admin/rides/:id — timeline, fare, payment rows and who marked it
   * paid; rider/driver cards carry masked phones only.
   */
  async getRideDetail(id: string) {
    const r = await this.rides
      .findOne({ where: { id }, relations: ['rider', 'driver', 'driver.user'] })
      .catch(() => null);
    if (!r) throw new NotFoundException('Ride not found');
    const paymentRows = await this.payments
      .find({ where: { rideId: r.id }, order: { createdAt: 'DESC' } })
      .catch(() => []);
    // R-7: routed road length (Mapbox, straight-line x1.3 fallback), used to
    // flag inflated distance claims. Async on purpose — cached 10 min per
    // pickup/dropoff, and a Mapbox failure degrades to the fallback factor.
    const routedKm = r.pickup && r.dropoff ? await this.routes.routedKm(r.pickup, r.dropoff) : 0;

    return {
      ...this.toRideSummary(r),
      pickup: r.pickup,
      dropoff: r.dropoff,
      fareBreakdown: r.fareBreakdown,
      distanceKm: r.distanceKm != null ? Number(r.distanceKm) : null,
      promoCode: r.promoCode ?? null,
      rating: r.rating ?? null,
      timeline: {
        createdAt: r.createdAt,
        offeredAt: r.offeredAt ?? null,
        matchedAt: r.matchedAt ?? null,
        startedAt: r.startedAt ?? null,
        completedAt: r.completedAt ?? null,
        cancelledAt: r.cancelledAt ?? null,
      },
      cancellation: {
        reason: r.cancellationReason ?? null,
        by: r.cancelledBy ?? null,
      },
      rider: {
        id: r.riderId,
        name: r.rider?.name ?? 'Rider',
        phone: maskPhone(r.rider?.phone),
      },
      driver: r.driverId
        ? {
            id: r.driverId,
            name: r.driver?.user?.name ?? 'Driver',
            phone: maskPhone(r.driver?.user?.phone),
            vehicleType: r.driver?.vehicleType ?? r.vehicleType,
            carModel: r.driver?.carModel ?? null,
            plateNumber: r.driver?.plateNumber ?? null,
            rating: r.driver ? Number(r.driver.rating) : null,
            // D-1: payee VPA the ride's QR pointed at (admin verification).
            upiVpa: r.driver?.upiVpa ?? null,
          }
        : null,
      // R-7: recorded distance vs the ROUTED route. >1.5x means the driver's
      // claim was inflated (fare was clamped at complete(), but the outlier
      // stays visible for review). Only meaningful post-completion —
      // pre-complete distanceKm is still the booking estimate.
      distanceOutlier:
        r.status === 'completed' &&
        routedKm > 0 &&
        Number(r.distanceKm ?? 0) > routedKm * 1.5,
      payments: paymentRows.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        status: p.status,
        providerOrderId: p.providerOrderId ?? null,
        providerPaymentId: p.providerPaymentId ?? null,
        createdAt: p.createdAt,
      })),
    };
  }

  /**
   * GET /admin/overview — dashboard counts + attention lists. "Today" runs on
   * the operator's day boundary (APP_TIMEZONE, default Asia/Kolkata — R-6),
   * and every list is whitelisted (no phones, no entities).
   */
  async overview() {
    const tz = appTimezone(this.config);
    const now = new Date();
    const startToday = zonedStartOfDay(now, tz);
    const start7d = zonedStartOfDayAgo(now, 7, tz);
    const stuckCutoff = new Date(now.getTime() - AdminService.STUCK_RIDE_MINUTES * 60_000);

    const applications = await this.listApplicationCounts();

    const driverStats = await this.drivers
      .createQueryBuilder('d')
      .select(`COUNT(*) FILTER (WHERE d."status" = 'approved')`, 'total')
      .addSelect(`COUNT(*) FILTER (WHERE d."status" = 'approved' AND d."isOnline")`, 'online')
      .getRawOne();

    const rideStats = await this.rides
      .createQueryBuilder('r')
      .select(`COUNT(*) FILTER (WHERE r."status" IN ('matched','driver_en_route','in_progress'))`, 'active')
      .addSelect(`COUNT(*) FILTER (WHERE r."createdAt" >= :start)`, 'today')
      .addSelect(`COUNT(*) FILTER (WHERE r."status" = 'completed' AND r."completedAt" >= :start)`, 'completedToday')
      .addSelect(`COUNT(*) FILTER (WHERE r."status" = 'cancelled' AND r."cancelledAt" >= :start)`, 'cancelledToday')
      .addSelect(`COUNT(*) FILTER (WHERE r."status" = 'completed' AND r."paymentStatus" <> 'paid')`, 'completedUnpaid')
      .addSelect(
        `COALESCE(SUM((r."fareBreakdown"->>'total')::numeric) FILTER (WHERE r."status" = 'completed' AND r."completedAt" >= :start), 0)`,
        'fareToday',
      )
      .addSelect(
        `COALESCE(SUM(r."tipAmount") FILTER (WHERE r."status" = 'completed' AND r."completedAt" >= :start), 0)`,
        'tipsToday',
      )
      .addSelect(
        `COALESCE(SUM((r."fareBreakdown"->>'total')::numeric) FILTER (WHERE r."status" = 'completed' AND r."completedAt" >= :start7), 0)`,
        'fare7d',
      )
      .setParameters({ start: startToday, start7: start7d })
      .getRawOne();

    // Attention: oldest pending first (nobody waits forever), then rides
    // stuck past the expected transition window, then unsettled payments.
    const oldestPending = await this.drivers
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.user', 'u')
      .where('d.status = :status', { status: 'pending' })
      .addSelect('COALESCE(d."submittedAt", d."createdAt")', 'queue_at')
      .orderBy('queue_at', 'ASC')
      .addOrderBy('d.id', 'ASC')
      .take(5)
      .getMany();

    const stuckRides = await this.rides
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.rider', 'rider')
      .where(
        `((r."status" = 'requested' AND r."createdAt" <= :cutoff) OR (r."status" = 'matched' AND r."matchedAt" <= :cutoff))`,
        { cutoff: stuckCutoff },
      )
      .orderBy('r.createdAt', 'ASC')
      .take(5)
      .getMany();

    const unpaidRides = await this.rides
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.rider', 'rider')
      .leftJoinAndSelect('r.driver', 'driver')
      .leftJoinAndSelect('driver.user', 'driverUser')
      .where(`r."status" = 'completed' AND r."paymentStatus" <> 'paid'`)
      .orderBy('r.completedAt', 'DESC')
      .take(5)
      .getMany();

    return {
      timezone: tz,
      generatedAt: now,
      applications,
      drivers: {
        total: Number(driverStats?.total ?? 0),
        online: Number(driverStats?.online ?? 0),
        onTrip: Number(rideStats?.active ?? 0),
      },
      rides: {
        active: Number(rideStats?.active ?? 0),
        today: Number(rideStats?.today ?? 0),
        completedToday: Number(rideStats?.completedToday ?? 0),
        cancelledToday: Number(rideStats?.cancelledToday ?? 0),
        completedUnpaid: Number(rideStats?.completedUnpaid ?? 0),
      },
      fares: {
        today: Number(rideStats?.fareToday ?? 0),
        tipsToday: Number(rideStats?.tipsToday ?? 0),
        last7Days: Number(rideStats?.fare7d ?? 0),
      },
      attention: {
        oldestPending: oldestPending.map((d) => this.toApplicationSummary(d)),
        stuckRides: stuckRides.map((r) => ({
          id: r.id,
          status: r.status,
          riderName: r.rider?.name ?? 'Rider',
          createdAt: r.createdAt,
          matchedAt: r.matchedAt ?? null,
        })),
        unpaidRides: unpaidRides.map((r) => this.toRideSummary(r)),
      },
      // The "Recent activity" feed is a dedicated GET /admin/audit call
      // (richer: target display names, own pagination/retry).
    };
  }

  /** GET /admin/audit — paginated, filterable audit feed. */
  async auditList(query: {
    action?: string;
    targetType?: 'driver' | 'ride';
    targetId?: string;
    actorUserId?: string;
    page?: number;
    limit?: number;
  }) {
    return this.audit.list(query.page, query.limit, {
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      actorUserId: query.actorUserId,
    });
  }

  private static readonly DOC_KINDS = {
    licenseImage: { label: 'Driving licence', path: 'licenseImagePath', legacyUrl: 'drivingLicenceImageUrl' },
    rcImage: { label: 'RC book', path: 'rcImagePath', legacyUrl: 'rcImageUrl' },
    vehiclePhoto: { label: 'Vehicle photo', path: 'vehiclePhotoPath', legacyUrl: 'carImageUrl' },
  } as const;

  private async accessFor(d: any, kind: keyof typeof AdminService.DOC_KINDS): Promise<DocumentAccess | null> {
    const def = AdminService.DOC_KINDS[kind];
    const stored: string | null | undefined = d[def.path] || d[def.legacyUrl];
    if (!stored) return null;
    return this.storage.getDocumentAccess(stored);
  }

  /** Single document (GET /admin/files/:applicationId/:kind). */
  async getDocument(applicationId: string, kind: string): Promise<DocumentAccess> {
    if (!(kind in AdminService.DOC_KINDS)) throw new BadRequestException('Unknown document kind');
    const d = (await this.drivers.findOne({ where: { id: applicationId } }).catch(() => null)) as any;
    if (!d) throw new NotFoundException('Application not found');
    const access = await this.accessFor(d, kind as keyof typeof AdminService.DOC_KINDS);
    if (!access) throw new NotFoundException('Document not uploaded');
    return access;
  }

  /** All documents of an application with fresh signed URLs (for the admin dashboard). */
  async listDocuments(applicationId: string) {
    const d = (await this.drivers.findOne({ where: { id: applicationId } }).catch(() => null)) as any;
    if (!d) throw new NotFoundException('Application not found');
    const out: Array<{
      kind: string;
      label: string;
      mime: string;
      url: string | null;
      base64?: string;
      expiresAt: string | null;
    }> = [];
    for (const kind of Object.keys(AdminService.DOC_KINDS) as Array<keyof typeof AdminService.DOC_KINDS>) {
      const access = await this.accessFor(d, kind);
      if (!access) continue;
      const label = AdminService.DOC_KINDS[kind].label;
      if (access.type === 'url') {
        out.push({ kind, label, mime: access.mime, url: access.url, expiresAt: access.expiresAt || null });
      } else {
        // Legacy local file: no URL exists, so inline it (small, admin-only).
        out.push({ kind, label, mime: access.mime, url: null, base64: access.buffer.toString('base64'), expiresAt: null });
      }
    }
    return { applicationId, documents: out };
  }

  private async forceOffline(d: any) {
    try {
      d.isOnline = false;
      d.isAvailable = false;
      await this.geo.removeDriver(d.id, d.vehicleType).catch(() => {});
    } catch {
      // best-effort
    }
  }
}
