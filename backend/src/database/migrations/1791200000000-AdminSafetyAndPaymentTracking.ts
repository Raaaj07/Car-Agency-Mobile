import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 (safety & money):
 *  - drivers.approvedAt          — reinstate is only legal from a driver that
 *                                  was approved before (A-2); backfilled from
 *                                  the most recent review of approved drivers.
 *  - rides.paymentMarkedBy       — who flipped paymentStatus to paid
 *                                  (rider|driver|admin|provider) (P-1).
 *  - payments unique (rideId, providerOrderId) — create-order idempotency
 *    (P-2). providerOrderId becomes nullable so legacy duplicate pending
 *    orders can be kept (older copy nulled) instead of deleted.
 */
export class AdminSafetyAndPaymentTracking1791200000000 implements MigrationInterface {
  name = 'AdminSafetyAndPaymentTracking1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "approvedAt" timestamptz`);
    await queryRunner.query(
      `UPDATE "drivers" SET "approvedAt" = COALESCE("reviewedAt", "createdAt")
       WHERE "status" = 'approved' AND "approvedAt" IS NULL`,
    );

    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "paymentMarkedBy" varchar(16)`);

    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "providerOrderId" DROP NOT NULL`);
    // Keep the newest row per (rideId, providerOrderId); older duplicates keep
    // their data but lose the order id so the unique index can be created.
    await queryRunner.query(
      `UPDATE "payments" p SET "providerOrderId" = NULL
       FROM (
         SELECT "id", ROW_NUMBER() OVER (
           PARTITION BY "rideId", "providerOrderId"
           ORDER BY "createdAt" DESC, "id" DESC
         ) AS rn
         FROM "payments"
       ) d
       WHERE p."id" = d."id" AND d.rn > 1`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payments_ride_order" ON "payments" ("rideId", "providerOrderId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_payments_ride_order"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "paymentMarkedBy"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "approvedAt"`);
    // providerOrderId stays nullable (deleting legacy duplicate rows would be
    // destructive; making it NOT NULL again could fail if nulls exist).
  }
}
