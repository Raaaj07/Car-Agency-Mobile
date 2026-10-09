import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SEC-2b: `users.email` is self-asserted — PATCH /auth/me stores any address
 * with no proof — so Google sign-in may only link an account by email when
 * this server-side flag says the address was proven (Google's email_verified
 * claim). Without it, an attacker pre-setting the victim's address on their
 * own account would capture the victim's next "Sign in with Google".
 *
 * New migration (existing migrations are never edited); `IF NOT EXISTS`
 * makes it a no-op on dev databases where DB_SYNCHRONIZE already created the
 * column. Verified by src/integration/schema.integration.spec.ts, which
 * diffs every entity column against the migrated schema.
 */
export class AddUserEmailVerified1791500000000 implements MigrationInterface {
  name = 'AddUserEmailVerified1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerified" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "emailVerified"`);
  }
}
