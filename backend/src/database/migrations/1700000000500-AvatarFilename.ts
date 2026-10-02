import { MigrationInterface, QueryRunner } from 'typeorm';

// No schema change needed for server-hosted avatars: users.avatar stores the
// local file name (uploads/avatars/<userId>/<file>); remote URLs from social
// sign-in keep working until the user uploads a new photo.
export class AvatarFilenameComment1700000000500 implements MigrationInterface {
  name = 'AvatarFilenameComment1700000000500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMENT ON COLUMN "users"."avatar" IS 'Remote URL (social sign-in) or local avatar file name under uploads/avatars/<userId>/'`);
  }

  public async down(): Promise<void> {
    // Comment-only migration; nothing to revert.
  }
}
