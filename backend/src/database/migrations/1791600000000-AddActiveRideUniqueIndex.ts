import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SEC-4: POST /rides checked "no active ride" with count() and then INSERTed
 * — two concurrent bookings from the same rider both saw zero and
 * double-booked (two active rides, two driver searches, two offers). Only the
 * database can close that race: a partial unique index on riderId restricted
 * to ACTIVE statuses (history stays unlimited). create() keeps its friendly
 * pre-check and maps a 23505 unique violation onto the same message.
 *
 * Legacy duplicates (from the historical race window) are resolved first so
 * index creation cannot fail: the furthest-progressed ride per rider is kept
 * (an in_progress trip is never the one cancelled), older stragglers are
 * cancelled as system. Idempotent — no duplicates means no rows change.
 *
 * Existing migrations are never edited; RideEntity declares the same index
 * (name + columns + where) so DB_SYNCHRONIZE neither drops nor recreates it.
 * Also asserted by src/main.ts findSchemaProblems (dev auto-repair /
 * production report) and src/database/schema-repair.ts.
 */
export class AddActiveRideUniqueIndex1791600000000 implements MigrationInterface {
  name = 'AddActiveRideUniqueIndex1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) resolve historical duplicates: keep the furthest-progressed active
    //    ride (then most recently touched), cancel the rest.
    await queryRunner.query(`
      WITH dup AS (
        SELECT "id",
               ROW_NUMBER() OVER (
                 PARTITION BY "riderId"
                 ORDER BY CASE "status"
                            WHEN 'in_progress' THEN 4
                            WHEN 'driver_en_route' THEN 3
                            WHEN 'matched' THEN 2
                            ELSE 1
                          END DESC,
                          "updatedAt" DESC NULLS LAST,
                          "createdAt" DESC,
                          "id"
               ) AS rn
        FROM "rides"
        WHERE "status" IN ('requested', 'matched', 'driver_en_route', 'in_progress')
      )
      UPDATE "rides" r
      SET "status" = 'cancelled',
          "cancellationReason" = 'duplicate_active_ride',
          "cancelledBy" = 'system',
          "cancelledAt" = NOW()
      FROM dup
      WHERE r."id" = dup."id" AND dup.rn > 1
    `);
    // 2) the guard itself.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rides_active_per_rider"
      ON "rides" ("riderId")
      WHERE "status" IN ('requested', 'matched', 'driver_en_route', 'in_progress')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_rides_active_per_rider"`);
  }
}
