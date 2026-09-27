import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
import { JwtPayload } from '../../auth/strategies/jwt.strategy';

interface AuthedSocket extends Socket {
  data: { userId?: string; role?: 'rider' | 'driver' | null };
}

/**
 * Real-time channel backing:
 *  - driver:location -> forwarded to the rider tracking a ride (room-scoped
 *    per rideId), consumed by TripProgressScreen's live map.
 *  - ride:request     -> pushed to the matched driver (RideRequestNearbyScreen).
 *  - ride:status      -> pushed to the rider on every status change
 *                        (FindingDriver -> YouGotTheRide -> DriverEnRoute -> ...).
 *
 * Auth: client connects with `auth: { token: <access token> }` (or
 * `?token=` query param); the JWT is verified the same way the HTTP
 * JwtStrategy does.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/realtime' })
export class RidesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RidesGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: AuthedSocket): void {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.query?.token as string | undefined);
      if (!token) {
        throw new Error('missing token');
      }
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      client.join(this.userRoom(payload.sub));
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
  @SubscribeMessage('ride:join')
  onJoinRide(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { rideId: string }): void {
    if (!client.data.userId) return;
    client.join(this.rideRoom(data.rideId));
  }

  @SubscribeMessage('ride:leave')
  onLeaveRide(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { rideId: string }): void {
    client.leave(this.rideRoom(data.rideId));
  }

  // Driver app streams its position while a ride is active; relayed 1:1 to
  // whoever else is in the ride room (the rider).
  @SubscribeMessage('driver:location')
  onDriverLocation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { rideId: string; lat: number; lng: number },
  ): void {
    if (client.data.role !== 'driver') return;
    client.to(this.rideRoom(data.rideId)).emit('driver:location', {
      rideId: data.rideId,
      lat: data.lat,
      lng: data.lng,
      at: new Date().toISOString(),
    });
  }

  /** Server-initiated push: a new ride request to the matched driver. */
  emitRideRequestToDriver(driverUserId: string, payload: unknown): void {
    this.server.to(this.userRoom(driverUserId)).emit('ride:request', payload);
  }

  /** Server-initiated push: a status change to the rider (and driver, if online). */
  emitRideStatus(rideId: string, riderUserId: string, driverUserId: string | null, payload: unknown): void {
    this.server.to(this.userRoom(riderUserId)).emit('ride:status', payload);
    if (driverUserId) {
      this.server.to(this.userRoom(driverUserId)).emit('ride:status', payload);
    }
    this.server.to(this.rideRoom(rideId)).emit('ride:status', payload);
  }
}
