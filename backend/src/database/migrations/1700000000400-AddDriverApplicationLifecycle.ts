import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDriverApplicationLifecycle1700000000400 implements MigrationInterface {
  name = 'AddDriverApplicationLifecycle1700000000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'pending'`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rejectionReason" varchar(300)`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reviewedByUserId" uuid`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reviewedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "submittedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "licenseImagePath" text`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcImagePath" text`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehiclePhotoPath" text`);
    // Existing rows (incl. legacy self-registered test drivers) become approved.
    await queryRunner.query(
      `UPDATE "drivers" SET "status" = CASE WHEN "verificationStatus" IN ('pending','approved','rejected') THEN "verificationStatus" ELSE 'approved' END, "submittedAt" = COALESCE("submittedAt", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ['"vehiclePhotoPath"', '"rcImagePath"', '"licenseImagePath"', '"submittedAt"', '"reviewedAt"', '"reviewedByUserId"', '"rejectionReason"', '"status"']) {
      await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS ${c}`);
    }
  }
}
