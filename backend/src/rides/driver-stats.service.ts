import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { DriverEntity } from '../drivers/entities/driver.entity';
import { RideEntity } from './entities/ride.entity';

const IST_OFFSET_MS = 330 * 60_000; // service area is India; days roll over at IST midnight
const DAY_MS = 86_400_000;
const STALE_LOCATION_MS = 5 * 60_000;
const WINDOW_DAYS = 30;

export interface DriverStats {
  today: { trips: number; earnings: number };
  week: { trips: number; earnings: number; tips: number };
  month: { trips: number; earnings: number; tips: number };
  /** Last 7 IST days, oldest first. */
  daily: Array<{ date: string; trips: number; earnings: number }>;
  acceptance: { rate: number | null; accepted: number; declinedOrMissed: number; windowDays: number };
  availability: {
    state: 'online' | 'on_trip' | 'offline';
    reason: 'not_approved' | 'location_stale' | 'manual' | null;
    message: string;
  };
}

const istDay = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class DriverStatsService {
  constructor(
    @InjectRepository(RideEntity) private readonly rides: Repository<RideEntity>,
    @InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>,
  ) {}

  async forUser(userId: string, now = new Date()): Promise<DriverStats> {
    const driver = await this.drivers.findOne({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver profile not found');

    const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
    const completed = await this.rides.find({
      where: { driverId: driver.id, status: 'completed', completedAt: MoreThanOrEqual(since) },
      select: { id: true, completedAt: true, fareBreakdown: true, tipAmount: true },
      order: { completedAt: 'DESC' },
      take: 2000,
    });

    const todayKey = istDay(now);
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) dayKeys.push(istDay(new Date(now.getTime() - i * DAY_MS)));
    const daily = new Map(dayKeys.map((k) => [k, { date: k, trips: 0, earnings: 0 }]));

    const week = { trips: 0, earnings: 0, tips: 0 };
    const month = { trips: 0, earnings: 0, tips: 0 };
    const today = { trips: 0, earnings: 0 };
    for (const r of completed) {
      if (!r.completedAt) continue;
      const tip = r.tipAmount ?? 0;
      const amount = Number(r.fareBreakdown?.total ?? 0) + tip;
      const key = istDay(r.completedAt);
      month.trips++;
      month.earnings += amount;
      month.tips += tip;
      const bucket = daily.get(key);
      if (bucket) {
        bucket.trips++;
        bucket.earnings += amount;
        week.trips++;
        week.earnings += amount;
        week.tips += tip;
      }
      if (key === todayKey) {
        today.trips++;
        today.earnings += amount;
      }
    }

    // Acceptance: rides this driver was offered in the window — matched to
    // them (accepted) vs ones they declined or let time out (the offer
    // timeout adds the driver to declinedDriverIds as well).
    const accepted = await this.rides.count({ where: { driverId: driver.id, matchedAt: MoreThanOrEqual(since) } });
    const declinedOrMissed = await this.rides
      .createQueryBuilder('r')
      .where(':id = ANY(r."declinedDriverIds")', { id: driver.id })
      .andWhere('r."createdAt" >= :since', { since })
      .getCount();
    const offered = accepted + declinedOrMissed;

    return {
      today: { trips: today.trips, earnings: round2(today.earnings) },
      week: { trips: week.trips, earnings: round2(week.earnings), tips: round2(week.tips) },
      month: { trips: month.trips, earnings: round2(month.earnings), tips: round2(month.tips) },
      daily: [...daily.values()].map((d) => ({ ...d, earnings: round2(d.earnings) })),
      acceptance: {
        rate: offered > 0 ? Math.round((accepted / offered) * 100) : null,
        accepted,
        declinedOrMissed,
        windowDays: WINDOW_DAYS,
      },
      availability: this.availability(driver, now),
    };
  }

  private availability(d: DriverEntity, now: Date): DriverStats['availability'] {
    if (d.status !== 'approved') {
      return {
        state: 'offline',
        reason: 'not_approved',
        message:
          d.status === 'suspended'
            ? 'You are offline because your driver account is suspended. Contact support.'
            : `You are offline because your application is ${d.status}.`,
      };
    }
    if (d.isOnline) {
      return d.isAvailable
        ? { state: 'online', reason: null, message: 'You are online and receiving ride requests.' }
        : { state: 'on_trip', reason: null, message: 'You are on a trip.' };
    }
    const age = d.locationUpdatedAt ? now.getTime() - d.locationUpdatedAt.getTime() : null;
    if (age !== null && age > STALE_LOCATION_MS && age < 60 * 60_000) {
      return {
        state: 'offline',
        reason: 'location_stale',
        message:
          'You were taken offline because your location stopped updating. Check location permission and internet, then go online.',
      };
    }
    return { state: 'offline', reason: 'manual', message: 'You are offline. Switch online to receive ride requests.' };
  }
}
