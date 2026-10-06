import { Repository } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { VehicleType } from '../../drivers/entities/driver.entity';

/**
 * Pure, testable pieces of the dev seed (Task 7):
 *  - DETERMINISTIC — each driver's data derives from a per-index seeded PRNG,
 *    so driver #i always gets the same phone/name/vehicle/position no matter
 *    what ran before (re-running after a partial failure converges).
 *  - IDEMPOTENT — the plan only describes rows that are missing; existing
 *    user/driver rows are never touched by seed.ts.
 *  - admin accounts come from ADMIN_PHONES (same trailing-10-digit matching
 *    as AdminService/AuthService, A-1).
 */

export const PRNG_SEED = 20260101;
// Deterministic phone block for mock drivers: 9840000000–9840099999.
export const PHONE_PREFIX = '98400';
// Seeded drivers never send heartbeats: pin `driver:lastseen` ~10 years ahead
// so the 90s ghost filter keeps them visible to searchNearby() and the 30s
// sweep never force-offlines them in Postgres (real drivers get scores from
// their app's location heartbeat instead).
export const LASTSEEN_PIN_MS = 10 * 365 * 24 * 60 * 60 * 1000;

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

/** mulberry32 — tiny deterministic PRNG: same seed => same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Random point within `spreadKm` of the city center (rough equirectangular offset). */
export function pointNear(
  rng: () => number,
  centerLat: number,
  centerLng: number,
  spreadKm: number,
): { lat: number; lng: number } {
  const kmPerDegLat = 111;
  const kmPerDegLng = 111 * Math.cos((centerLat * Math.PI) / 180);
  const dLat = ((rng() * 2 - 1) * spreadKm) / kmPerDegLat;
  const dLng = ((rng() * 2 - 1) * spreadKm) / kmPerDegLng;
  return { lat: centerLat + dLat, lng: centerLng + dLng };
}

export function phoneForIndex(i: number): string {
  if (i > 99_999) {
    throw new Error('SEED_DRIVER_COUNT exceeds the deterministic phone range (9840000000-9840099999)');
  }
  return `${PHONE_PREFIX}${String(i).padStart(5, '0')}`;
}

function plateFor(rng: () => number): string {
  const stateCodes = ['TN 30', 'TN 33', 'TN 29', 'KA 05'];
  const letters =
    String.fromCharCode(65 + Math.floor(rng() * 26)) + String.fromCharCode(65 + Math.floor(rng() * 26));
  const digits = Math.floor(1000 + rng() * 9000);
  return `${pick(rng, stateCodes)} ${letters} ${digits}`;
}

/** Everything a mock driver row needs, derived ONLY from its index. */
export interface SeedDriverPlan {
  phone: string;
  name: string;
  vehicleType: VehicleType;
  carModel: string;
  plateNumber: string;
  lat: number;
  lng: number;
  isOnline: boolean;
  rating: string;
  totalTrips: number;
}

export function planDriver(
  i: number,
  opts: { centerLat: number; centerLng: number; spreadKm: number },
): SeedDriverPlan {
  // Per-index stream: driver i's data depends only on i, so a skipped/partial
  // earlier run can never shift the values of later drivers.
  const rng = mulberry32(PRNG_SEED + i);
  const vehicleType = pick(rng, VEHICLE_TYPES);
  const { lat, lng } = pointNear(rng, opts.centerLat, opts.centerLng, opts.spreadKm);
  return {
    phone: phoneForIndex(i),
    name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    vehicleType,
    carModel: pick(rng, CAR_MODELS[vehicleType]),
    plateNumber: plateFor(rng),
    lat,
    lng,
    isOnline: i % 5 !== 0, // ~80% online so /drivers/nearby has results
    rating: (4 + rng()).toFixed(2),
    totalTrips: Math.floor(rng() * 400),
  };
}

/** Same trailing-10-digit normalisation as AdminService/AuthService (A-1). */
export function adminPhonesFromEnv(raw = process.env.ADMIN_PHONES ?? ''): string[] {
  return raw
    .split(',')
    .map((s) => s.replace(/\D/g, '').slice(-10))
    .filter((s) => s.length === 10);
}

/**
 * Idempotent admin backfill from an explicit phone list (ADMIN_PHONES):
 * creates missing accounts with role `admin`, promotes existing non-admin
 * rows, and leaves admins as they are. Returns how many rows changed.
 */
export async function ensureAdminUsers(
  userRepo: Repository<UserEntity>,
  phones: string[],
): Promise<number> {
  let changed = 0;
  for (const phone of phones) {
    const existing = await userRepo.findOne({ where: { phone } });
    if (!existing) {
      await userRepo.save(
        userRepo.create({ phone, name: 'Admin', role: 'admin', language: 'en', isActive: true }),
      );
      changed += 1;
    } else if (existing.role !== 'admin') {
      existing.role = 'admin';
      await userRepo.save(existing);
      changed += 1;
    }
  }
  return changed;
}
