import 'dotenv/config';
import 'reflect-metadata';
import Redis from 'ioredis';
import { DataSource, In } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { DriverEntity } from '../../drivers/entities/driver.entity';
import { dataSourceOptions } from '../../config/typeorm.datasource';
import {
  LASTSEEN_PIN_MS,
  adminPhonesFromEnv,
  ensureAdminUsers,
  phoneForIndex,
  planDriver,
} from './seed-data';

/**
 * Dev seed (Task 7: idempotent + deterministic — see seed-data.ts for the
 * guarantees and seed-data.spec.ts for the tests).
 *
 *   npm run seed            # safe to re-run; never touches existing rows
 *
 * Pre-Task-7 runs used random phones and are NOT cleaned up by this script
 * (delete those rows manually if you still have them).
 */
async function seed() {
  const cityName = process.env.SEED_CITY_NAME ?? 'Salem, Tamil Nadu';
  const centerLat = parseFloat(process.env.SEED_CITY_LAT ?? '11.6643');
  const centerLng = parseFloat(process.env.SEED_CITY_LNG ?? '78.1460');
  const spreadKm = parseFloat(process.env.SEED_SPREAD_KM ?? '6');
  const driverCount = parseInt(process.env.SEED_DRIVER_COUNT ?? '40', 10);

  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('Refusing to seed in production (NODE_ENV=production)');
  }

  console.log(`Seeding ${driverCount} mock drivers around ${cityName} (${centerLat}, ${centerLng})...`);

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  });

  const userRepo = dataSource.getRepository(UserEntity);
  const driverRepo = dataSource.getRepository(DriverEntity);

  // Admins first: the driver loop then skips those phones (a phone is one
  // account, and the owner's account must never become a mock driver).
  const adminPhones = adminPhonesFromEnv();
  const adminsChanged = await ensureAdminUsers(userRepo, adminPhones);

  // Deterministic phones: driver i's data derives only from i, so partial
  // runs converge instead of drifting (see planDriver).
  const phones = Array.from({ length: driverCount }, (_, i) => phoneForIndex(i));
  const existingUsers = await userRepo.find({ where: { phone: In(phones) } });
  const userByPhone = new Map(existingUsers.map((u) => [u.phone ?? '', u]));
  const existingDrivers = existingUsers.length
    ? await driverRepo.find({ where: { userId: In(existingUsers.map((u) => u.id)) } })
    : [];
  const driverByUserId = new Map(existingDrivers.map((d) => [d.userId, d]));

  let created = 0;
  let untouched = 0;

  for (let i = 0; i < driverCount; i++) {
    const phone = phones[i];
    const plan = planDriver(i, { centerLat, centerLng, spreadKm });

    let user = userByPhone.get(phone);
    if (user?.role === 'admin') {
      untouched += 1; // owner's phone — never a mock driver
      continue;
    }
    if (!user) {
      user = await userRepo.save(
        userRepo.create({
          phone: plan.phone,
          name: plan.name,
          role: 'driver',
          language: 'en',
          isActive: true,
        }),
      );
      created += 1;
    } else {
      untouched += 1; // pre-existing row: leave role/name/phone untouched
    }

    let driver = driverByUserId.get(user.id);
    if (!driver) {
      const now = new Date();
      driver = await driverRepo.save(
        driverRepo.create({
          userId: user.id,
          vehicleType: plan.vehicleType,
          carModel: plan.carModel,
          plateNumber: plan.plateNumber,
          // Approved immediately: ApprovedDriverGuard + ride matching require
          // it, and a mock driver nobody can ride with is useless for dev.
          status: 'approved',
          approvedAt: now,
          submittedAt: now,
          isOnline: plan.isOnline,
          isAvailable: plan.isOnline,
          location: { type: 'Point', coordinates: [plan.lng, plan.lat] },
          locationUpdatedAt: now,
          rating: plan.rating,
          totalTrips: plan.totalTrips,
        }),
      );
    }

    // Redis geo entries: deterministic values, so re-running is a pure
    // refresh (zadd overwrites the same coordinates).
    if (plan.isOnline) {
      await redis.geoadd(`drivers:geo:${plan.vehicleType}`, plan.lng, plan.lat, driver.id);
      await redis.geoadd('drivers:geo:all', plan.lng, plan.lat, driver.id);
      await redis.hset(`drivers:meta:${driver.id}`, { vehicleType: plan.vehicleType }); // no TTL: dev stand-in
      await redis.zadd('driver:lastseen', Date.now() + LASTSEEN_PIN_MS, driver.id);
    } else {
      // Keep the offline half out of the map even if an earlier run (or a
      // flipped online flag) left entries behind.
      await redis.zrem(`drivers:geo:${plan.vehicleType}`, driver.id);
      await redis.zrem('drivers:geo:all', driver.id);
      await redis.del(`drivers:meta:${driver.id}`);
      await redis.zrem('driver:lastseen', driver.id);
    }
  }

  console.log(
    `Seed complete: ${created} driver(s) created, ${untouched} existing left untouched, ${adminsChanged} admin(s) ensured (${adminPhones.length} in ADMIN_PHONES).`,
  );
  await redis.quit();
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
