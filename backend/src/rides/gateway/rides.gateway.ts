import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { DriverEntity } from '../../drivers/entities/driver.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';
import { RideEntity } from '../entities/ride.entity';

interface AuthedSocket extends Socket {
  data: { userId?: string; role?: 'rider' | 'driver' | 'admin' | null };
}

/**
 * Real-time channel backing:
 *  - driver:location -> forwarded to the rider tracking a ride (room-scoped
 *    per rideId), consumed by TripProgressScreen's live map.
 *  - ride:request     -> pushed to the matched driver (RideRequestNearbyScreen).
 *  - ride:status      -> pushed to the rider on every status change
 *                        (FindingDriver -> YouGotTheRide -> DriverEnRoute -> ...).
 *
 * Auth: client connects with `auth: { token: <access token> }`, verified the
 * same way the HTTP JwtStrategy does (DB lookup for active user).
 */
function gatewayCorsOrigin(): '*' | string[] | false {
  const raw = (process.env.CORS_ORIGIN ?? '*').trim();
  if (raw === '*') return process.env.NODE_ENV === 'production' ? false : '*';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : false;
}

@WebSocketGateway({ cors: { origin: gatewayCorsOrigin() }, namespace: '/realtime' })
export class RidesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RidesGateway.name);
  // Basic per-socket rate limit for driver:location (max 1 msg / 2s).
  private readonly lastLocationAt = new WeakMap<object, number>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      // auth-only: ?token= query support removed (tokens in URLs leak to
      // proxies/logs). Clients must send auth: { token }.
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        throw new Error('missing token');
      }
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      // Reject sockets whose user is missing or deactivated, matching the
      // HTTP JwtStrategy (which does a DB lookup for the same reason).
      const user = await this.users.findOne({ where: { id: payload.sub } });
      if (!user || user.isActive === false) {
        throw new Error('user no longer active');
      }
      client.data.userId = user.id;
      client.data.role = (user.role ?? 'rider') as AuthedSocket['data']['role'];
      client.join(this.userRoom(user.id));
    } catch (err) {
      this.logger.warn(`Rejected socket connection: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: AuthedSocket): void {
    // Rooms are cleaned up automatically by Socket.IO on disconnect.
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private rideRoom(rideId: string) {
    return `ride:${rideId}`;
  }

  // Riders and drivers both call this once they know the rideId, so
  // driver:location broadcasts within a trip only reach that trip's pair.
  // Membership-verified: only the ride's rider or its assigned (approved)
  // driver may join. (B9 fix.)
  @SubscribeMessage('ride:join')
  async onJoinRide(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { rideId: string }): Promise<void> {
    const userId = client.data.userId;
    if (!userId) return;
    if (!data?.rideId || typeof data.rideId !== 'string') return;
    const ride = await this.rides.findOne({ where: { id: data.rideId } }).catch(() => null);
    if (!ride) return;
    if (ride.riderId === userId) {
      client.join(this.rideRoom(data.rideId));
      return;
    }
    const driver = await this.drivers.findOne({ where: { userId } }).catch(() => null);
    if (driver && ride.driverId === driver.id) {
      client.join(this.rideRoom(data.rideId));
    }
  }

  @SubscribeMessage('ride:leave')
  onLeaveRide(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { rideId: string }): void {
    client.leave(this.rideRoom(data.rideId));
  }

  // Driver app streams its position while a ride is active; relayed 1:1 to
  // whoever else is in the ride room (the rider). Authorized by approved
  // driver status + ride ownership — never by the JWT role claim. (B9/B11 fix.)
  @SubscribeMessage('driver:location')
  async onDriverLocation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { rideId: string; lat: number; lng: number },
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId) return;
    if (!data?.rideId || !Number.isFinite(data?.lat) || !Number.isFinite(data?.lng)) return;
    if (data.lat < -90 || data.lat > 90 || data.lng < -180 || data.lng > 180) return;
    // Throttle: drop messages more frequent than 1 per 2s per socket.
    const now = Date.now();
    const last = this.lastLocationAt.get(client) ?? 0;
    if (now - last < 2000) return;
    this.lastLocationAt.set(client, now);
    const driver = await this.drivers.findOne({ where: { userId } }).catch(() => null);
    if (!driver || (driver as any).status !== 'approved') return;
    const ride = await this.rides.findOne({ where: { id: data.rideId } }).catch(() => null);
    if (!ride || ride.driverId !== driver.id) return;
    client.to(this.rideRoom(data.rideId)).emit('driver:location', {
      rideId: data.rideId,
      lat: data.lat,
      lng: data.lng,
      at: new Date().toISOString(),
    });
  }

  @SubscribeMessage('ride:request:ack')
  onRideRequestAck(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { rideId: string },
  ): void {
    this.logger.log(`Driver ${client.data.userId} acknowledged ride request ${data?.rideId}`);
  }

  @SubscribeMessage('nearby:subscribe')
  onNearbySubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() _data: { lat: number; lng: number },
  ): void {
    if (!client.data.userId) return;
    client.join('nearby:drivers');
  }

  @SubscribeMessage('nearby:unsubscribe')
  onNearbyUnsubscribe(@ConnectedSocket() client: AuthedSocket): void {
    client.leave('nearby:drivers');
  }

  emitNearbyUpdate(payload: unknown): void {
    this.server.to('nearby:drivers').emit('nearby:update', payload);
  }

  /** Server-initiated push: driver application status change (reject/suspend). */
  emitDriverStatus(driverUserId: string, payload: unknown): void {
    this.server.to(this.userRoom(driverUserId)).emit('driver:status', payload);
  }

  /** Server-initiated push: a new ride request to the matched driver. */
  emitRideRequestToDriver(driverUserId: string, payload: unknown): void {
    this.server.to(this.userRoom(driverUserId)).emit('ride:request', payload);
  }

  /** Server-initiated push: a status change to the rider (and driver, if online). */
  emitRideStatus(rideId: string, riderUserId: string, driverUserId: string | null, payload: any): void {
    // Rider receives full payload including pickupOtp
    this.server.to(this.userRoom(riderUserId)).emit('ride:status', payload);

    // Driver and public room receive status with pickupOtp omitted (driver must collect OTP from rider)
    const driverPayload = payload && typeof payload === 'object' ? { ...payload } : payload;
    if (driverPayload && typeof driverPayload === 'object' && 'pickupOtp' in driverPayload) {
      delete driverPayload.pickupOtp;
    }

    if (driverUserId) {
      this.server.to(this.userRoom(driverUserId)).emit('ride:status', driverPayload);
    }
    this.server.to(this.rideRoom(rideId)).emit('ride:status', driverPayload);
  }
}
