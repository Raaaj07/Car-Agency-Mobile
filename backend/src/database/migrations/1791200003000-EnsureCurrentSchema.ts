import { MigrationInterface, QueryRunner } from 'typeorm';
import { SCHEMA_REPAIR_STATEMENTS } from '../schema-repair';

/**
 * Brings a database in line with the current entities: rides offer/OTP
 * columns, widened payment status columns, promos tables, and re-asserts the
 * admin/driver columns. Fully idempotent (IF NOT EXISTS everywhere), so it is
 * safe whether the DB came from migrations, synchronize, or a mix.
 * See ../schema-repair.ts for the exact drift being fixed.
 */
export class EnsureCurrentSchema1791200003000 implements MigrationInterface {
  name = 'EnsureCurrentSchema1791200003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of SCHEMA_REPAIR_STATEMENTS) {
      await queryRunner.query(sql);
    }
  }

  public async down(): Promise<void> {
    // Intentionally empty: these columns/tables are required by the running
    // code, and dropping them would destroy ride, promo and audit data.
  }
}
