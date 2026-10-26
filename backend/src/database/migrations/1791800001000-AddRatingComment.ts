import { MigrationInterface, QueryRunner } from 'typeorm';

/** Optional free-text comment the rider can leave with a driver rating. */
export class AddRatingComment1791800001000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "ratingComment" varchar(300)`);
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "ratingComment"`);
  }
}
