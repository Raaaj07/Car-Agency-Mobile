import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5 (D-1 + D-2):
 *  - `drivers.upiVpa` — the payee VPA stored server-side, so the payment QR
 *    is generated from a profile value the admin can see and verify
 *    (previously it lived only in device SecureStore).
 *  - Drop the deprecated `verificationStatus`/`verificationNote` columns —
 *    `status`/`rejectionReason` are the canonical application lifecycle, and
 *    the legacy default `'approved'` would misreport every driver as verified
 *    to anything reading the old mirror.
 */
export class AddDriverUpiVpaAndDropVerificationColumns1791200002000
  implements MigrationInterface
{
  name = 'AddDriverUpiVpaAndDropVerificationColumns1791200002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "upiVpa" varchar(64)`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "verificationStatus"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "verificationNote"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "upiVpa"`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "verificationStatus" varchar(20) NOT NULL DEFAULT 'approved'`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "verificationNote" varchar(500)`);
  }
}
