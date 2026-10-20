import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { REDIS_CLIENT } from '../config/redis.module';
import { DeviceTokenEntity } from './device-token.entity';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Ride statuses a RIDER is notified about, with the copy for each. */
const RIDER_COPY: Record<string, PushMessage | undefined> = {
  matched: { title: 'Driver found', body: 'A driver accepted your ride.' },
  driver_en_route: { title: 'Driver on the way', body: 'Your driver is heading to the pickup point.' },
  in_progress: { title: 'Trip started', body: 'Your trip has started. Have a safe ride.' },
  completed: { title: 'Trip completed', body: 'Thanks for riding with Vazhi. Rate your ride.' },
};

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(DeviceTokenEntity) private readonly tokens: Repository<DeviceTokenEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async register(userId: string, token: string, platform: string, sessionId?: string): Promise<void> {
    await this.tokens.upsert(
      { userId, token, platform, sessionId: sessionId ?? null },
      { conflictPaths: ['token'], skipUpdateIfNoValuesChanged: false },
    );
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.tokens.delete({ userId, token });
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.users.update({ id: userId }, { pushEnabled: enabled });
  }

  async getEnabled(userId: string): Promise<boolean> {
    const u = await this.users.findOne({ where: { id: userId }, select: { id: true, pushEnabled: true } });
    return u?.pushEnabled ?? true;
  }

  /**
   * Called from RidesService.pushStatus for every status change. Fire and
   * forget: it never throws and never delays the ride flow. A status is sent
   * at most once per ride (Redis NX), even if pushStatus fires repeatedly.
   */
  async notifyRider(ride: { id: string; riderId: string; status: string; cancelledBy?: string | null }): Promise<void> {
    try {
      let msg = RIDER_COPY[ride.status];
      if (ride.status === 'cancelled' && ride.cancelledBy && ride.cancelledBy !== 'rider') {
        msg = { title: 'Ride cancelled', body: 'Your ride was cancelled. You can book again anytime.' };
      }
      if (!msg) return;
      const first = await this.redis
        .set(`push:ride:${ride.id}:${ride.status}`, '1', 'EX', 3600, 'NX')
        .catch(() => 'OK'); // Redis down: prefer a rare duplicate over a lost alert
      if (first !== 'OK') return;
      await this.sendToUser(ride.riderId, { ...msg, data: { type: 'ride', rideId: ride.id, status: ride.status } });
    } catch (err) {
      this.logger.warn(`notifyRider failed: ${(err as Error).message}`);
    }
  }

  async sendToUser(userId: string, msg: PushMessage): Promise<void> {
    if (!(await this.getEnabled(userId))) return;
    const rows = await this.tokens.find({ where: { userId } });
    if (!rows.length) return;
    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    const res = await axios.post(
      EXPO_PUSH_URL,
      rows.map((r) => ({ to: r.token, sound: 'default', priority: 'high', channelId: 'default', ...msg })),
      {
        timeout: 8000,
        headers: { Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      },
    );
    // Tickets come back in request order — drop tokens Expo says are dead.
    const tickets: Array<{ status: string; details?: { error?: string } }> = res.data?.data ?? [];
    const dead = rows.filter((_, i) => tickets[i]?.status === 'error' && tickets[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length) await this.tokens.delete(dead.map((d) => d.id));
  }
}
