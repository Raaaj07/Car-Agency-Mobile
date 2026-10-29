import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Operator-editable runtime settings (driver search radius today). One row per
 * key; no seed row — the code falls back to its built-in default (10 km) until
 * an admin saves a value. Idempotent (IF NOT EXISTS).
 */
export class AddAppSettings1791900000000 implements MigrationInterface {
  name = 'AddAppSettings1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_settings" (
        "key" varchar(64) PRIMARY KEY,
        "value" varchar(255) NOT NULL,
        "updatedBy" varchar(36),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "app_settings"`);
  }
}
