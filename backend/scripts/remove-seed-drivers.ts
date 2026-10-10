/**
 * Undo the dev seed:  npm run db:unseed
 *
 * Removes exactly what src/database/seeds/seed.ts created:
 *   - users whose phone lies in the deterministic block
 *     9840000000-9840099999 (PHONE_PREFIX) and are not admins,
 *   - their `drivers` rows,
 *   - their Redis entries (drivers:geo:*, drivers:meta:*, driver:lastseen).
 *
 * Guards: refuses NODE_ENV=production; keeps any seeded driver that has
 * ride history (FK) and reports it instead of failing mid-transaction.
 * Idempotent — a second run reports nothing found.
 */
import 'dotenv/config';
import 'reflect-metadata';
import Redis from 'ioredis';
import { DataSource, In, Like, Not } from 'typeorm';
import { UserEntity } from '../src/auth/entities/user.entity';
import { DriverEntity } from '../src/drivers/entities/driver.entity';
import { RideEntity } from '../src/rides/entities/ride.entity';
import { dataSourceOptions } from '../src/config/typeorm.datasource';
import { PHONE_PREFIX } from '../src/database/seeds/seed-data';

async function main(): Promise<void> {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('Refusing to run in production (NODE_ENV=production)');
  }

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  });

  try {
    const userRepo = dataSource.getRepository(UserEntity);
    const driverRepo = dataSource.getRepository(DriverEntity);
    const rideRepo = dataSource.getRepository(RideEntity);

    // The seed's identity: deterministic phone block, never an admin row.
    const users = await userRepo.find({
      where: { phone: Like(`${PHONE_PREFIX}%`), role: Not('admin') },
    });

    if (users.length === 0) {
      console.log('No seeded users found — nothing to remove.');
    } else {
      const userIds = users.map((u) => u.id);
      const drivers = await driverRepo.find({ where: { userId: In(userIds) } });

      // FK guard: a mock driver that took a real booking must not abort the
      // removal — keep those pairs and say so.
      const ridden = drivers.length
        ? await rideRepo.find({
            where: { driverId: In(drivers.map((d) => d.id)) },
            select: { id: true, driverId: true },
          })
        : [];
      const keepDriverIds = new Set(ridden.map((r) => r.driverId).filter((x): x is string => !!x));
      const delDrivers = drivers.filter((d) => !keepDriverIds.has(d.id));
      const keepUserIds = new Set(
        drivers.filter((d) => keepDriverIds.has(d.id)).map((d) => d.userId),
      );
      const delUserIds = users.filter((u) => !keepUserIds.has(u.id)).map((u) => u.id);

      await dataSource.transaction(async (manager) => {
        if (delDrivers.length) {
          await manager.delete(DriverEntity, { id: In(delDrivers.map((d) => d.id)) });
        }
        if (delUserIds.length) {
          await manager.delete(UserEntity, { id: In(delUserIds) });
        }
      });

      // Redis: mirror of the seed's geo/meta/lastseen writes.
      for (const driver of delDrivers) {
        await redis.zrem(`drivers:geo:${driver.vehicleType}`, driver.id);
        await redis.zrem('drivers:geo:all', driver.id);
        await redis.del(`drivers:meta:${driver.id}`);
        await redis.zrem('driver:lastseen', driver.id);
      }

      console.log(
        `Removed ${delDrivers.length} seeded driver(s) and ${delUserIds.length} user(s); Redis entries cleared.`,
      );
      if (keepDriverIds.size > 0) {
        console.log(
          `Kept ${keepDriverIds.size} seeded driver(s) that have ride history — delete those rides first if you want them gone too.`,
        );
      }
    }

    const [driversLeft, usersLeft] = await Promise.all([
      driverRepo.count(),
      userRepo.count(),
    ]);
    console.log(`Database now holds ${driversLeft} driver row(s) and ${usersLeft} user row(s) in total.`);
  } finally {
    await redis.quit();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('Unseed failed:', err);
  process.exit(1);
});
