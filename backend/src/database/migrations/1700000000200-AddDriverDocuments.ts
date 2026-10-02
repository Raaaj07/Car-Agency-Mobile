import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDriverDocuments1700000000200 implements MigrationInterface {
  name = 'AddDriverDocuments1700000000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "profilePhotoUrl" text`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "carImageUrl" text`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "drivingLicenceNumber" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "drivingLicenceImageUrl" text`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcNumber" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rcImageUrl" text`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "verificationStatus" varchar(20) NOT NULL DEFAULT 'approved'`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "verificationNote" varchar(500)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "verificationNote"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "verificationStatus"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rcImageUrl"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rcNumber"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "drivingLicenceImageUrl"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "drivingLicenceNumber"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "carImageUrl"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "profilePhotoUrl"`);
  }
}
