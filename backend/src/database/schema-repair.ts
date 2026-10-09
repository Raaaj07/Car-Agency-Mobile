/**
 * Idempotent schema repair.
 *
 * WHY THIS EXISTS: the TypeORM entities drifted from the migration chain.
 * A database built from migrations (or an older synchronize run) is missing
 * columns/tables the code now reads and writes, so `POST /rides` (INSERT into
 * rides) and every driver/promo query failed with "column ... does not exist"
 * -> HTTP 500 -> "Booking failed" on the rider, and the matcher silently
 * returned "no drivers" (matchNearestDriver errors are caught in create()).
 *
 * Drift fixed here:
 *  - rides.offeredAt / offerExpiresAt / declinedDriverIds / otpAttempts /
 *    otpLockedUntil were never in any migration (matching + OTP lockout).
 *  - rides.paymentStatus and payments.status were varchar(10) but the P-1
 *    state machine writes 'rider_claimed' (13 chars) -> "value too long".
 *  - promos / promo_redemptions tables had no migration at all.
 *  - drivers.approvedAt / upiVpa, rides.paymentMarkedBy, admin_audit_logs
 *    (re-asserted so a half-applied chain still ends up correct).
 *
 * Every statement is safe to run any number of times, on any DB state.
 */
export const SCHEMA_REPAIR_STATEMENTS: string[] = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

  // ── users (social login / profile / refresh rotation) ──────────────────
  `ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" varchar(255)`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" varchar(255)`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appleId" varchar(255)`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileComplete" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "refreshTokenHash" varchar(128)`,
  // SEC-2b: provenance flag for users.email (Google link-by-email gate).
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerified" boolean NOT NULL DEFAULT false`,

  // ── drivers ─────────────────────────────────────────────────────────────
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "profilePhotoUrl" text`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "carImageUrl" text`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "drivingLicenceNumber" varchar(40)`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "drivingLicenceImageUrl" text`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcNumber" varchar(40)`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcImageUrl" text`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rejectionReason" varchar(300)`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reviewedByUserId" uuid`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reviewedAt" timestamptz`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "approvedAt" timestamptz`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "submittedAt" timestamptz`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "licenseImagePath" text`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcImagePath" text`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehiclePhotoPath" text`,
  `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "upiVpa" varchar(64)`,
  // Approved drivers that predate approvedAt must stay reinstatable.
  `UPDATE "drivers" SET "approvedAt" = COALESCE("reviewedAt", "createdAt")
     WHERE "status" = 'approved' AND "approvedAt" IS NULL`,

  // ── rides (matching, OTP lockout, payment tracking) ─────────────────────
  `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "offeredAt" timestamptz`,
  `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "offerExpiresAt" timestamptz`,
  `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "declinedDriverIds" text[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "otpAttempts" int NOT NULL DEFAULT 0`,
  `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "otpLockedUntil" timestamptz`,
  `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "paymentMarkedBy" varchar(16)`,
  // 'rider_claimed' is 13 chars; the original varchar(10) rejected it.
  `ALTER TABLE "rides" ALTER COLUMN "paymentStatus" TYPE varchar(16)`,

  // ── payments ────────────────────────────────────────────────────────────
  `ALTER TABLE "payments" ALTER COLUMN "status" TYPE varchar(16)`,
  `ALTER TABLE "payments" ALTER COLUMN "providerOrderId" DROP NOT NULL`,

  // ── saved places ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "saved_places" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
     "label" varchar(20) NULL,
     "title" varchar(120) NOT NULL,
     "address" varchar(300) NOT NULL,
     "lat" double precision NOT NULL,
     "lng" double precision NOT NULL,
     "geoKey" varchar(32) NOT NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now()
   )`,

  // ── admin audit log ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "actorUserId" varchar(36),
     "actorName" varchar(120),
     "action" varchar(40) NOT NULL,
     "targetType" varchar(20) NOT NULL,
     "targetId" varchar(36) NOT NULL,
     "reason" varchar(300),
     "meta" jsonb,
     "createdAt" timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_target" ON "admin_audit_logs" ("targetType", "targetId")`,
  `CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_created" ON "admin_audit_logs" ("createdAt" DESC)`,

  // ── promos (PR-1) — previously had NO migration ─────────────────────────
  `CREATE TABLE IF NOT EXISTS "promos" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "code" varchar(30) NOT NULL,
     "title" varchar(140),
     "subtitle" varchar(200),
     "cta" varchar(40),
     "discountAmount" int NOT NULL,
     "firstRideOnly" boolean NOT NULL DEFAULT false,
     "active" boolean NOT NULL DEFAULT true,
     "validFrom" timestamptz,
     "validTo" timestamptz,
     "maxRedemptions" int,
     "redemptionCount" int NOT NULL DEFAULT 0,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     "updatedAt" timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_promos_code" ON "promos" ("code")`,
  `CREATE TABLE IF NOT EXISTS "promo_redemptions" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "promoId" uuid REFERENCES "promos"("id") ON DELETE SET NULL,
     "code" varchar(30) NOT NULL,
     "rideId" uuid NOT NULL,
     "riderId" uuid NOT NULL,
     "discountAmount" int NOT NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_promo_redemptions_promo" ON "promo_redemptions" ("promoId")`,
  `CREATE INDEX IF NOT EXISTS "IDX_promo_redemptions_rider" ON "promo_redemptions" ("riderId")`,
  // The old hard-coded promo, so the home carousel is not empty after repair.
  `INSERT INTO "promos" ("code", "title", "subtitle", "cta", "discountAmount", "firstRideOnly", "active")
     VALUES ('VAZHI20', 'Rs 20 off your first ride', 'Tap to apply code VAZHI20', 'Apply', 20, true, true)
     ON CONFLICT ("code") DO NOTHING`,
];
