import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task 2: Replace the single refreshTokenHash column on users with a dedicated
 * refresh_sessions table that supports multiple simultaneous device sessions.
 *
 * The old `users.refreshTokenHash` column is kept (nullable) so existing rows
 * remain valid until the column is dropped in a future cleanup migration.
 * During the transition window, the auth service reads ONLY the new table.
 */
export class AddRefreshSessions1791700000000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS refresh_sessions (
        id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        "userId"     UUID        NOT NULL,
        "familyId"   UUID        NOT NULL,
        "tokenHash"  VARCHAR(64) NOT NULL,
        "previousTokenHash" VARCHAR(64),
        "previousTokenAt"   TIMESTAMPTZ,
        "deviceLabel" VARCHAR(128),
        "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "lastUsedAt" TIMESTAMPTZ,
        "expiresAt"  TIMESTAMPTZ NOT NULL,
        "revokedAt"  TIMESTAMPTZ
      )
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id
        ON refresh_sessions ("userId")
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_sessions_family_id
        ON refresh_sessions ("familyId")
    `);
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS refresh_sessions`);
  }
}
