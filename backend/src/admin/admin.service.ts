import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { GeoService } from '../drivers/geo.service';
import { DocumentAccess, StorageService } from '../drivers/storage.service';
import { RidesGateway } from '../rides/gateway/rides.gateway';
import { RideEntity } from '../rides/entities/ride.entity';

type AppStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

@Injectable()
export class AdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    private readonly geo: GeoService,
    private readonly storage: StorageService,
    private readonly gateway: RidesGateway,
    private readonly config: ConfigService,
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

  async listApplications(status?: string, page = 1, limit = 20) {
    const where = status && this.requireStatus(status) ? { status } : {};
    const [items, total] = await this.drivers.findAndCount({
      where: where as any,
      relations: ['user'],
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: Math.min(limit, 100),
    });
    return {
      items: items.map((d: any) => ({
        id: d.id,
        userId: d.userId,
        applicantName: d.user?.name ?? 'Unknown',
        phone: d.user?.phone ?? '',
        status: d.status,
        vehicleType: d.vehicleType,
        carModel: d.carModel,
        plateNumber: d.plateNumber,
        licenseNumber: d.drivingLicenceNumber ?? null,
        submittedAt: d.submittedAt ?? d.createdAt,
        reviewedAt: d.reviewedAt ?? null,
      })),
      total,
      page,
      limit,
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
    d.status = 'approved';
    d.rejectionReason = null;
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    // A-2: reinstate is only legal while approvedAt is set — stamp it here.
    d.approvedAt = new Date();
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'approved' });
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
    d.status = 'rejected';
    d.rejectionReason = r;
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    await this.forceOffline(d);
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'rejected', reason: r });
    return this.getApplication(id);
  }

  // A-3: suspending a driver mid-trip would orphan the rider. Default: 409
  // carrying the ride id; `{ force: true }` cancels that ride first
  // (cancelledBy='admin', rider gets the status push), then suspends.
  async suspend(id: string, reviewerId: string, opts?: { force?: boolean }) {
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
      await this.cancelRideForAdmin(activeRide.id, 'Driver suspended by admin');
    }
    d.status = 'suspended';
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    await this.forceOffline(d);
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'suspended' });
    return this.getApplication(id);
  }

  async reinstate(id: string, reviewerId: string) {
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
    return this.getApplication(id);
  }

  private static readonly ACTIVE_RIDE_STATUSES = ['matched', 'driver_en_route', 'in_progress'] as const;

  /**
   * Cancels an active ride on behalf of an admin action (A-3 force-suspend;
   * Phase 2 admin ride-cancel reuses this). Frees the driver's availability
   * without touching their online flag, and pushes the status so the rider
   * isn't left hanging.
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

  // GET /admin/rides — newest-first ride list for the admin console. Exposes
  // only names/addresses/fare/payment flags (never phone or document paths).
  async listRides(page = 1, limit = 20) {
    const [items, total] = await this.rides.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: Math.min(limit, 100),
      relations: ['rider', 'driver', 'driver.user'],
    });
    return {
      items: items.map((r: any) => ({
        id: r.id,
        status: r.status,
        vehicleType: r.vehicleType,
        riderName: r.rider?.name ?? 'Rider',
        driverName: r.driver?.user?.name ?? r.driver?.name ?? 'Unassigned',
        pickupAddress: r.pickup?.address ?? '',
        dropoffAddress: r.dropoff?.address ?? '',
        fareTotal: Number(r.fareBreakdown?.total ?? 0),
        tipAmount: Number(r.tipAmount ?? 0),
        paymentStatus: r.paymentStatus ?? 'pending',
        paymentMethod: r.paymentMethod ?? 'upi',
        createdAt: r.createdAt,
        completedAt: r.completedAt ?? null,
      })),
      total,
      page,
      limit,
    };
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
