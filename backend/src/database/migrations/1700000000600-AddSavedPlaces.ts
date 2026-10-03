import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSavedPlaces1700000000600 implements MigrationInterface {
  name = 'AddSavedPlaces1700000000600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "saved_places" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "label" varchar(20) NULL,
        "title" varchar(120) NOT NULL,
        "address" varchar(300) NOT NULL,
        "lat" double precision NOT NULL,
        "lng" double precision NOT NULL,
        "geoKey" varchar(32) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_saved_places_user_geokey" ON "saved_places" ("userId", "geoKey")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_saved_places_user_label" ON "saved_places" ("userId", "label") WHERE label IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_saved_places_userid" ON "saved_places" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "saved_places"`);
  }
}
