import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 (admin backend):
 *  - admin_audit_logs — one row per review/admin action (approve, reject,
 *    suspend, reinstate, ride cancel, payment resolution) so re-applying can
 *    never erase review history (A-12) and money decisions stay auditable.
 *    actorName is a snapshot: reviewer names must survive user deletion.
 */
export class AdminAuditLogs1791200001000 implements MigrationInterface {
  name = 'AdminAuditLogs1791200001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actorUserId" varchar(36),
        "actorName" varchar(120),
        "action" varchar(40) NOT NULL,
        "targetType" varchar(20) NOT NULL,
        "targetId" varchar(36) NOT NULL,
        "reason" varchar(300),
        "meta" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // History lookups are per driver (detail screen) / per ride.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_target"
       ON "admin_audit_logs" ("targetType", "targetId")`,
    );
    // Overview "recent activity" feed.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_created"
       ON "admin_audit_logs" ("createdAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_audit_logs_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_audit_logs_target"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_audit_logs"`);
  }
}
