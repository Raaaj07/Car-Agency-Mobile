import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RACE: matching read `isAvailable` and then set it false, so two bookings
 * could claim the same driver before either wrote — the driver received two
 * offers and could end up with two active rides. Matching now claims the
 * driver with a conditional UPDATE (DriversService.claimAvailability), and
 * this partial unique index is the database backstop: at most one ACTIVE ride
 * per driver. Completed/cancelled history stays unlimited.
 *
 * Legacy duplicates (from the race window) are resolved first so index
 * creation cannot fail: the furthest-progressed active ride per driver is
 * kept, older stragglers are cancelled as system. Idempotent.
 *
 * RideEntity declares the same index (name + columns + where) so
 * DB_SYNCHRONIZE neither drops nor recreates it. main.ts findSchemaProblems
 * and schema-repair.ts assert/create it too.
 */
export class AddActiveRidePerDriverIndex1792000000000 implements MigrationInterface {
  name = 'AddActiveRidePerDriverIndex1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) resolve historical duplicates: keep the furthest-progressed active
    //    ride per driver (then most recently touched), cancel the rest.
    await queryRunner.query(`
      WITH dup AS (
        SELECT "id",
               ROW_NUMBER() OVER (
                 PARTITION BY "driverId"
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
        WHERE "driverId" IS NOT NULL
          AND "status" IN ('requested', 'matched', 'driver_en_route', 'in_progress')
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
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rides_active_per_driver"
      ON "rides" ("driverId")
      WHERE "driverId" IS NOT NULL
        AND "status" IN ('requested', 'matched', 'driver_en_route', 'in_progress')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_rides_active_per_driver"`);
  }
}
