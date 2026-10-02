import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfileComplete1700000000300 implements MigrationInterface {
  name = 'AddUserProfileComplete1700000000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileComplete" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "refreshTokenHash" varchar(128)`);
    // Existing users with a real name (not the onboarding placeholder) count as complete.
    await queryRunner.query(
      `UPDATE "users" SET "profileComplete" = true WHERE "name" IS NOT NULL AND "name" NOT LIKE 'New %'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "refreshTokenHash"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "profileComplete"`);
  }
}
