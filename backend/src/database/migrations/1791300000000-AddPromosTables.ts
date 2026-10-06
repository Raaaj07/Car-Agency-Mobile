import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task 8 (PR-1): promo codes move from the hard-coded PROMOS_CONFIG array to
 * Postgres.
 *  - promos — admin-managed row (code, rider-card copy, discount,
 *    firstRideOnly, active, validity window, redemption cap).
 *  - promo_redemptions — one row per completed ride that used a code; feeds
 *    the cap + history. promoId is SET NULL and `code` is kept, so deleting a
 *    promo never destroys redemption history.
 *  - VAZHI20 is inserted with the exact old config copy, so rider behaviour
 *    (the only public code) is unchanged after `npm run migration:run`.
 */
export class AddPromosTables1791300000000 implements MigrationInterface {
  name = 'AddPromosTables1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promos" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(30) NOT NULL,
        "title" varchar(140),
        "subtitle" varchar(200),
        "cta" varchar(40),
        "discountAmount" int NOT NULL,
        "firstRideOnly" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "validFrom" timestamptz,
        "validTo" timestamptz,
        "maxRedemptions" int,
        "redemptionCount" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_promos_code" ON "promos" ("code")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promo_redemptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "promoId" uuid REFERENCES "promos"("id") ON DELETE SET NULL,
        "code" varchar(30) NOT NULL,
        "rideId" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
        "riderId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "discountAmount" int NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Admin promo detail + per-rider redemption lookups.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_promo_redemptions_promo" ON "promo_redemptions" ("promoId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_promo_redemptions_rider" ON "promo_redemptions" ("riderId")`,
    );

    // Preserve the pre-existing public code (exact PROMOS_CONFIG copy) so
    // behaviour is unchanged after migration:run. Idempotent.
    await queryRunner.query(`
      INSERT INTO "promos" ("code", "title", "subtitle", "cta", "discountAmount", "firstRideOnly", "active")
      VALUES ('VAZHI20', 'Rs 20 off your first ride', 'Tap to apply code VAZHI20', 'Apply', 20, true, true)
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promo_redemptions_rider"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promo_redemptions_promo"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promo_redemptions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promos_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promos"`);
  }
}
