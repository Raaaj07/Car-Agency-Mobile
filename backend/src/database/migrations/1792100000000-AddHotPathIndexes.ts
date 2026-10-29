import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hot-path indexes for the queries the apps make constantly.
 *
 *  - rides (riderId, status): "my active ride" and rider trip history.
 *  - rides (driverId, status): driver earnings/stats and active-trip checks.
 *  - rides (status, updatedAt): the stale-`requested` sweep.
 *  - refresh_sessions tokenHash / previousTokenHash: every /auth/refresh lookup.
 *  - refresh_sessions expiresAt: the daily dead-session purge.
 *
 * Plain (non-unique) indexes, IF NOT EXISTS so re-running is harmless.
 * Entity decorators declare the same names/shapes so DB_SYNCHRONIZE keeps them.
 */
export class AddHotPathIndexes1792100000000 implements MigrationInterface {
  name = 'AddHotPathIndexes1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rides_rider_status" ON "rides" ("riderId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rides_driver_status" ON "rides" ("driverId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rides_status_updated" ON "rides" ("status", "updatedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_sessions_token_hash" ON "refresh_sessions" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_sessions_prev_hash" ON "refresh_sessions" ("previousTokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_sessions_expires" ON "refresh_sessions" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'IDX_rides_rider_status',
      'IDX_rides_driver_status',
      'IDX_rides_status_updated',
      'IDX_refresh_sessions_token_hash',
      'IDX_refresh_sessions_prev_hash',
      'IDX_refresh_sessions_expires',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${name}"`);
    }
  }
}
