import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Safety features: rider emergency contact, expiring live trip-share link and
 * SOS flag. The share token is stored only as a SHA-256 hash.
 */
export class AddSafetyFeatures1791800000000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emergencyContactName" varchar(120)`);
    await runner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emergencyContactPhone" varchar(20)`);
    await runner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "shareTokenHash" varchar(64)`);
    await runner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "shareExpiresAt" timestamptz`);
    await runner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "sosAt" timestamptz`);
    await runner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "sosLocation" jsonb`);
    await runner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rides_shareTokenHash" ON "rides" ("shareTokenHash") WHERE "shareTokenHash" IS NOT NULL`,
    );
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS "IDX_rides_shareTokenHash"`);
    await runner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "sosLocation"`);
    await runner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "sosAt"`);
    await runner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "shareExpiresAt"`);
    await runner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "shareTokenHash"`);
    await runner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "emergencyContactPhone"`);
    await runner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "emergencyContactName"`);
  }
}
