import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { DriversService } from '../drivers/drivers.service';
import { ACTIVE_RIDE_STATUSES, RideEntity } from './entities/ride.entity';

const SHARE_TTL_MS = 6 * 60 * 60_000; // link dies 6 h after it is created…
const SHARE_POST_TRIP_MS = 30 * 60_000; // …or 30 min after the trip ends

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface SharedTripView {
  status: string;
  riderFirstName: string | null;
  pickup: { address: string; lat: number; lng: number };
  dropoff: { address: string; lat: number; lng: number };
  vehicleType: string;
  driver: { name: string; vehicleModel: string | null; plateNumber: string | null } | null;
  // Only while a trip is live — never after completion/cancellation.
  driverLocation: { lat: number; lng: number; updatedAt: string | null } | null;
  sos: boolean;
  expiresAt: string;
}

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly drivers: DriversService,
    private readonly config: ConfigService,
  ) {}

  // ---- emergency contact -------------------------------------------------

  async getEmergencyContact(userId: string) {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    return { name: u.emergencyContactName ?? null, phone: u.emergencyContactPhone ?? null };
  }

  async setEmergencyContact(userId: string, name: string | null, phone: string | null) {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    if (phone && u.phone && phone.replace(/\D/g, '').slice(-10) === u.phone.replace(/\D/g, '').slice(-10)) {
      throw new BadRequestException('Emergency contact must be someone other than you');
    }
    await this.users.update({ id: userId }, { emergencyContactName: name, emergencyContactPhone: phone });
    return { name, phone };
  }

  // ---- live trip share ---------------------------------------------------

  private async ownRide(rideId: string, riderId: string): Promise<RideEntity> {
    const ride = await this.rides.findOne({ where: { id: rideId } });
    // 404 (not 403) so ride ids cannot be probed.
    if (!ride || ride.riderId !== riderId) throw new NotFoundException('Ride not found');
    return ride;
  }

  /** Creates (or rotates) the share link. The raw token is returned once. */
  async createShare(rideId: string, riderId: string) {
    const ride = await this.ownRide(rideId, riderId);
    if (!(ACTIVE_RIDE_STATUSES as readonly string[]).includes(ride.status)) {
      throw new ConflictException('Only an active trip can be shared');
    }
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS);
    await this.rides.update({ id: ride.id }, { shareTokenHash: sha256(token), shareExpiresAt: expiresAt });
    const base = (this.config.get<string>('PUBLIC_API_URL') ?? '').replace(/\/+$/, '');
    const path = `/safety/share/${token}/view`;
    return { token, path, url: base ? `${base}${path}` : null, expiresAt };
  }

  async revokeShare(rideId: string, riderId: string) {
    const ride = await this.ownRide(rideId, riderId);
    await this.rides.update({ id: ride.id }, { shareTokenHash: null, shareExpiresAt: null });
    return { ok: true };
  }

  /** Public, read-only view for whoever holds the link. */
  async viewShared(token: string): Promise<SharedTripView> {
    if (!token || token.length < 16 || token.length > 128) throw new NotFoundException('Link not found');
    const ride = await this.rides.findOne({ where: { shareTokenHash: sha256(token) }, relations: { rider: true } });
    if (!ride || !ride.shareExpiresAt) throw new NotFoundException('Link not found');

    const live = (ACTIVE_RIDE_STATUSES as readonly string[]).includes(ride.status);
    const endedAt = ride.completedAt ?? ride.cancelledAt ?? null;
    const now = Date.now();
    if (
      ride.shareExpiresAt.getTime() < now ||
      (!live && endedAt && now - endedAt.getTime() > SHARE_POST_TRIP_MS)
    ) {
      throw new NotFoundException('This link has expired');
    }

    let driver: SharedTripView['driver'] = null;
    let driverLocation: SharedTripView['driverLocation'] = null;
    if (ride.driverId) {
      try {
        const d: any = await this.drivers.findById(ride.driverId);
        driver = {
          name: d.user?.name?.split(/\s+/)[0] ?? 'Driver',
          vehicleModel: d.carModel ?? d.vehicleModel ?? null,
          plateNumber: d.plateNumber ?? null,
        };
        const c = d.location?.coordinates;
        if (live && Array.isArray(c) && c.length === 2) {
          driverLocation = {
            lat: Number(c[1]),
            lng: Number(c[0]),
            updatedAt: d.locationUpdatedAt ? new Date(d.locationUpdatedAt).toISOString() : null,
          };
        }
      } catch {
        /* driver lookup is best-effort for a read-only view */
      }
    }

    const first = (ride.rider as any)?.name?.trim().split(/\s+/)[0];
    return {
      status: ride.status,
      riderFirstName: first || null,
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      vehicleType: ride.vehicleType,
      driver,
      driverLocation,
      sos: !!ride.sosAt,
      expiresAt: ride.shareExpiresAt.toISOString(),
    };
  }

  // ---- SOS ---------------------------------------------------------------

  /**
   * Flags the ride for the admin console and returns the rider's emergency
   * contact + a pre-filled share link so the app can open the SMS composer.
   * Either party on the ride may raise it.
   */
  async raiseSos(rideId: string, userId: string, location?: { lat: number; lng: number }) {
    const ride = await this.rides.findOne({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');
    let isParty = ride.riderId === userId;
    if (!isParty && ride.driverId) {
      try {
        const d = await this.drivers.findById(ride.driverId);
        isParty = d?.userId === userId;
      } catch {
        /* not a party */
      }
    }
    if (!isParty) throw new ForbiddenException('Not your ride');
    if (!(ACTIVE_RIDE_STATUSES as readonly string[]).includes(ride.status)) {
      throw new ConflictException('SOS is only available during an active trip');
    }
    await this.rides.update({ id: ride.id }, { sosAt: new Date(), sosLocation: location ?? null });
    // Structured, greppable line — also what a log-based alert should key on.
    this.logger.error(
      JSON.stringify({ event: 'sos', rideId: ride.id, by: userId, status: ride.status, location: location ?? null }),
    );
    const contact = await this.getEmergencyContact(ride.riderId).catch(() => null);
    return {
      ok: true,
      emergencyContact: contact && contact.phone ? contact : null,
      emergencyNumber: this.config.get<string>('EMERGENCY_NUMBER') ?? '112',
    };
  }
}

export function renderSharedTripHtml(v: SharedTripView, _token: string): string {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const map = v.driverLocation
    ? `<p><a href="https://www.google.com/maps?q=${v.driverLocation.lat},${v.driverLocation.lng}">Open driver location in Maps</a></p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15"><meta name="robots" content="noindex"><title>Trip status</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;color:#111}
.s{display:inline-block;padding:4px 10px;border-radius:12px;background:#eef;font-weight:600}.sos{background:#fdd;color:#a00}</style></head><body>
<h2>${esc(v.riderFirstName ?? 'A rider')}'s trip</h2>
<p><span class="s ${v.sos ? 'sos' : ''}">${esc(v.sos ? 'SOS raised · ' : '')}${esc(v.status.replace(/_/g, ' '))}</span></p>
<p><b>From:</b> ${esc(v.pickup.address)}<br><b>To:</b> ${esc(v.dropoff.address)}</p>
${v.driver ? `<p><b>Driver:</b> ${esc(v.driver.name)}<br><b>Vehicle:</b> ${esc(v.driver.vehicleModel ?? '')} ${esc(v.driver.plateNumber ?? '')}</p>` : ''}
${map}<p style="color:#666;font-size:13px">Updates every 15 seconds. Link expires ${esc(v.expiresAt)}.</p></body></html>`;
}
