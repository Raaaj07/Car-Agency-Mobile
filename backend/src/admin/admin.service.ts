import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { GeoService } from '../drivers/geo.service';
import { StorageService } from '../drivers/storage.service';
import { RidesGateway } from '../rides/gateway/rides.gateway';

type AppStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

@Injectable()
export class AdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
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

  async suspend(id: string, reviewerId: string) {
    const d = (await this.drivers.findOne({ where: { id } })) as any;
    if (!d) throw new NotFoundException('Driver not found');
    if (d.status === 'suspended') return this.getApplication(id); // idempotent
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
    d.status = 'approved';
    d.rejectionReason = null;
    d.reviewedByUserId = reviewerId;
    d.reviewedAt = new Date();
    await this.drivers.save(d);
    this.gateway.emitDriverStatus(d.userId, { status: 'approved' });
    return this.getApplication(id);
  }

  async readDocument(applicationId: string, kind: string) {
    if (!['licenseImage', 'rcImage', 'vehiclePhoto'].includes(kind)) {
      throw new BadRequestException('Unknown document kind');
    }
    const d = (await this.drivers.findOne({ where: { id: applicationId } })) as any;
    if (!d) throw new NotFoundException('Application not found');
    const localPath =
      kind === 'licenseImage' ? d.licenseImagePath : kind === 'rcImage' ? d.rcImagePath : d.vehiclePhotoPath;
    if (!localPath) throw new NotFoundException('Document not uploaded');
    return this.storage.readAbsolute(localPath);
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
