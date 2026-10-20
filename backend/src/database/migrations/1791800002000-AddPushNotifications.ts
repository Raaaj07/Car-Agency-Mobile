import { MigrationInterface, QueryRunner } from 'typeorm';

/** Push notifications: per-device Expo tokens + a per-user opt-out flag. */
export class AddPushNotifications1791800002000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id          UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        "userId"    UUID         NOT NULL,
        "sessionId" UUID,
        token       VARCHAR(200) NOT NULL,
        platform    VARCHAR(10)  NOT NULL DEFAULT 'android',
        "createdAt" TIMESTAMP    NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP    NOT NULL DEFAULT now()
      )
    `);
    await runner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_device_tokens_token" ON device_tokens (token)`);
    await runner.query(`CREATE INDEX IF NOT EXISTS "IDX_device_tokens_userId" ON device_tokens ("userId")`);
    await runner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pushEnabled" boolean NOT NULL DEFAULT true`);
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pushEnabled"`);
    await runner.query(`DROP TABLE IF EXISTS device_tokens`);
  }
}
