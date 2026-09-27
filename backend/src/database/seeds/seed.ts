import 'dotenv/config';
import 'reflect-metadata';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { DriverEntity, VehicleType } from '../../drivers/entities/driver.entity';
import { dataSourceOptions } from '../../config/typeorm.datasource';

const VEHICLE_TYPES: VehicleType[] = ['auto', 'mini', 'sedan', 'suv'];
const CAR_MODELS: Record<VehicleType, string[]> = {
  auto: ['Bajaj RE Compact', 'Piaggio Ape', 'TVS King'],
  mini: ['Maruti Alto K10', 'Hyundai Santro', 'Tata Tiago'],
  sedan: ['Maruti Dzire', 'Honda Amaze', 'Hyundai Aura'],
  suv: ['Mahindra Marazzo', 'Toyota Innova', 'Maruti Ertiga'],
};
const FIRST_NAMES = [
  'Rajesh', 'Suresh', 'Karthik', 'Vijay', 'Ganesh', 'Murugan', 'Prakash', 'Senthil',
  'Arun', 'Bala', 'Dinesh', 'Elango', 'Farook', 'Gopal', 'Hari', 'Ilango',
  'Jagan', 'Kannan', 'Lakshman', 'Mani', 'Naveen', 'Om Prakash', 'Pandi', 'Ravi',
];
const LAST_NAMES = ['Kumar', 'Raj', 'Moorthy', 'Pillai', 'Nathan', 'Prasad', 'Subramaniam', 'Iyer'];

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Random point within `spreadKm` of the city center (rough equirectangular offset). */
function randomPointNear(centerLat: number, centerLng: number, spreadKm: number): { lat: number; lng: number } {
  const kmPerDegLat = 111;
  const kmPerDegLng = 111 * Math.cos((centerLat * Math.PI) / 180);
  const dLat = randomBetween(-spreadKm, spreadKm) / kmPerDegLat;
  const dLng = randomBetween(-spreadKm, spreadKm) / kmPerDegLng;
  return { lat: centerLat + dLat, lng: centerLng + dLng };
}

function randomPhone(): string {
  const first = randomChoice(['6', '7', '8', '9']);
  let rest = '';
  for (let i = 0; i < 9; i++) rest += Math.floor(Math.random() * 10);
  return first + rest;
}

function randomPlate(): string {
  const stateCodes = ['TN 30', 'TN 33', 'TN 29', 'KA 05'];
  const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${randomChoice(stateCodes)} ${letters} ${digits}`;
}

async function seed() {
  const cityName = process.env.SEED_CITY_NAME ?? 'Salem, Tamil Nadu';
  const centerLat = parseFloat(process.env.SEED_CITY_LAT ?? '11.6643');
  const centerLng = parseFloat(process.env.SEED_CITY_LNG ?? '78.1460');
  const spreadKm = parseFloat(process.env.SEED_SPREAD_KM ?? '6');
  const driverCount = parseInt(process.env.SEED_DRIVER_COUNT ?? '40', 10);

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

  for (let i = 0; i < driverCount; i++) {
    const phone = randomPhone();
    const existing = await userRepo.findOne({ where: { phone } });
    if (existing) continue; // extremely unlikely collision, just skip

    const vehicleType = randomChoice(VEHICLE_TYPES);
    const name = `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`;
    const { lat, lng } = randomPointNear(centerLat, centerLng, spreadKm);
    const isOnline = Math.random() > 0.2; // ~80% online so /drivers/nearby has results

    const user = await userRepo.save(
      userRepo.create({ phone, name, role: 'driver', language: 'en', isActive: true }),
    );

    const driver = await driverRepo.save(
      driverRepo.create({
        userId: user.id,
        vehicleType,
        carModel: randomChoice(CAR_MODELS[vehicleType]),
        plateNumber: randomPlate(),
        isOnline,
        isAvailable: isOnline,
        location: { type: 'Point', coordinates: [lng, lat] },
        locationUpdatedAt: new Date(),
        rating: (4 + Math.random()).toFixed(2),
        totalTrips: Math.floor(Math.random() * 400),
      }),
    );

    if (isOnline) {
      await redis.geoadd(`drivers:geo:${vehicleType}`, lng, lat, driver.id);
      await redis.geoadd('drivers:geo:all', lng, lat, driver.id);
      await redis.hset(`drivers:meta:${driver.id}`, { vehicleType });
    }
  }

  console.log('Seed complete.');
  await redis.quit();
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
