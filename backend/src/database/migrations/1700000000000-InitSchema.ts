import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "postgis"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone" varchar(20) NOT NULL,
        "name" varchar(120) NOT NULL,
        "avatar" varchar(500),
        "role" varchar(10),
        "language" varchar(10) NOT NULL DEFAULT 'en',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_phone" ON "users" ("phone")`);

    await queryRunner.query(`
      CREATE TABLE "drivers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "vehicleType" varchar(10) NOT NULL,
        "carModel" varchar(120) NOT NULL,
        "plateNumber" varchar(20) NOT NULL,
        "isOnline" boolean NOT NULL DEFAULT false,
        "isAvailable" boolean NOT NULL DEFAULT false,
        "location" geometry(Point,4326),
        "locationUpdatedAt" timestamptz,
        "rating" decimal(3,2) NOT NULL DEFAULT 4.8,
        "totalTrips" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_drivers_userId" ON "drivers" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_drivers_location" ON "drivers" USING GIST ("location")`);

    await queryRunner.query(`
      CREATE TABLE "rides" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "riderId" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "driverId" uuid REFERENCES "drivers"("id") ON DELETE SET NULL,
        "status" varchar(20) NOT NULL DEFAULT 'requested',
        "vehicleType" varchar(10) NOT NULL,
        "pickup" jsonb NOT NULL,
        "dropoff" jsonb NOT NULL,
        "promoCode" varchar(20),
        "fareBreakdown" jsonb NOT NULL,
        "distanceKm" decimal(6,2),
        "pickupOtp" varchar(4),
        "cancellationReason" varchar(200),
        "cancelledBy" varchar(10),
        "paymentMethod" varchar(10) NOT NULL DEFAULT 'upi',
        "paymentStatus" varchar(10) NOT NULL DEFAULT 'pending',
        "rating" smallint,
        "compliments" jsonb,
        "tipAmount" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "matchedAt" timestamptz,
        "startedAt" timestamptz,
        "completedAt" timestamptz,
        "cancelledAt" timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_rides_riderId" ON "rides" ("riderId")`);
    await queryRunner.query(`CREATE INDEX "IDX_rides_driverId" ON "rides" ("driverId")`);
    await queryRunner.query(`CREATE INDEX "IDX_rides_status" ON "rides" ("status")`);

    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "rideId" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
        "method" varchar(10) NOT NULL,
        "amount" int NOT NULL,
        "providerOrderId" varchar(100) NOT NULL,
        "providerPaymentId" varchar(100),
        "status" varchar(10) NOT NULL DEFAULT 'pending',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_rideId" ON "payments" ("rideId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TABLE "rides"`);
    await queryRunner.query(`DROP TABLE "drivers"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
