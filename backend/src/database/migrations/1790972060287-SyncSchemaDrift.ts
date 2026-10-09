import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * M-2 fix: this legacy auto-generated migration used plain `ADD "col"` for
 * columns that the backdated 1700000000200 / 0300 / 0400 migrations already
 * create (with IF NOT EXISTS). On any FRESH database it therefore failed with
 * `column ... already exists` and `npm run migration:run` could never finish.
 *
 * Every statement is now idempotent, so:
 *  - fresh databases run the whole chain cleanly;
 *  - databases that already recorded this migration are unaffected (TypeORM
 *    tracks it by name and never re-runs it).
 */
export class SyncSchemaDrift1790972060287 implements MigrationInterface {
    name = 'SyncSchemaDrift1790972060287'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileComplete" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "refreshTokenHash" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "profilePhotoUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "carImageUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "drivingLicenceNumber" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "drivingLicenceImageUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcNumber" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcImageUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "verificationStatus" character varying(20) NOT NULL DEFAULT 'approved'`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "verificationNote" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "status" character varying(20) NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rejectionReason" character varying(300)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reviewedByUserId" uuid`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "licenseImagePath" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcImagePath" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehiclePhotoPath" text`);
        await queryRunner.query(`COMMENT ON COLUMN "users"."avatar" IS NULL`);
        await queryRunner.query(`ALTER TABLE "drivers" ALTER COLUMN "rating" SET DEFAULT '4.8'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "drivers" ALTER COLUMN "rating" SET DEFAULT 4.8`);
        await queryRunner.query(`COMMENT ON COLUMN "users"."avatar" IS 'Remote URL (social sign-in) or local avatar file name under uploads/avatars/<userId>/'`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "vehiclePhotoPath"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rcImagePath"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "licenseImagePath"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "submittedAt"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "reviewedAt"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "reviewedByUserId"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rejectionReason"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "status"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "verificationNote"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "verificationStatus"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rcImageUrl"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rcNumber"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "drivingLicenceImageUrl"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "drivingLicenceNumber"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "carImageUrl"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "profilePhotoUrl"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "refreshTokenHash"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "profileComplete"`);
    }

}
