import { MigrationInterface, QueryRunner } from "typeorm";

export class SyncSchemaDrift1790972060287 implements MigrationInterface {
    name = 'SyncSchemaDrift1790972060287'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "profileComplete" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "refreshTokenHash" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "profilePhotoUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "carImageUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "drivingLicenceNumber" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "drivingLicenceImageUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "rcNumber" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "rcImageUrl" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "verificationStatus" character varying(20) NOT NULL DEFAULT 'approved'`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "verificationNote" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "status" character varying(20) NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "rejectionReason" character varying(300)`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "reviewedByUserId" uuid`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "reviewedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "submittedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "licenseImagePath" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "rcImagePath" text`);
        await queryRunner.query(`ALTER TABLE "drivers" ADD "vehiclePhotoPath" text`);
        await queryRunner.query(`COMMENT ON COLUMN "users"."avatar" IS NULL`);
        await queryRunner.query(`ALTER TABLE "drivers" ALTER COLUMN "rating" SET DEFAULT '4.8'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "drivers" ALTER COLUMN "rating" SET DEFAULT 4.8`);
        await queryRunner.query(`COMMENT ON COLUMN "users"."avatar" IS 'Remote URL (social sign-in) or local avatar file name under uploads/avatars/<userId>/'`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "vehiclePhotoPath"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "rcImagePath"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "licenseImagePath"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "submittedAt"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "reviewedAt"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "reviewedByUserId"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "rejectionReason"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "verificationNote"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "verificationStatus"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "rcImageUrl"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "rcNumber"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "drivingLicenceImageUrl"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "drivingLicenceNumber"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "carImageUrl"`);
        await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "profilePhotoUrl"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "refreshTokenHash"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profileComplete"`);
    }

}
