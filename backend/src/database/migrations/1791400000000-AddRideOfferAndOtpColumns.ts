import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M-3 (found by the Task 11 integration suite): these `RideEntity` columns
 * existed only on the dev database via `DB_SYNCHRONIZE=true` drift — no
 * migration ever created them, so a fresh production database would fail
 * every ride INSERT (offer timestamps, declined-driver tracking, OTP
 * lockout counters). Added as a NEW migration (existing migrations are
 * never edited); `IF NOT EXISTS` makes it a no-op on dev, where synchronize
 * already created the columns. Verified by
 * `src/integration/schema.integration.spec.ts`, which diffs every entity
 * column against the migrated schema.
 */
export class AddRideOfferAndOtpColumns1791400000000 implements MigrationInterface {
  name = 'AddRideOfferAndOtpColumns1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "offeredAt" timestamptz`);
    await queryRunner.query(
      `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "offerExpiresAt" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "declinedDriverIds" text[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "otpAttempts" int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "otpLockedUntil" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "otpLockedUntil"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "otpAttempts"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "declinedDriverIds"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "offerExpiresAt"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "offeredAt"`);
  }
}
