import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialLogin1700000000100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "email" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "googleId" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "appleId" varchar(255)`);
    await queryRunner.query(`CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email") WHERE "email" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "users_google_id_unique" ON "users" ("googleId") WHERE "googleId" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "users_apple_id_unique" ON "users" ("appleId") WHERE "appleId" IS NOT NULL`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "users_apple_id_unique"`);
    await queryRunner.query(`DROP INDEX "users_google_id_unique"`);
    await queryRunner.query(`DROP INDEX "users_email_unique"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "appleId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "googleId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL`);
  }
}