import { DataSource, DataSourceOptions } from 'typeorm';
import { dataSourceOptions } from '../config/typeorm.datasource';

/**
 * Shared plumbing for the opt-in integration suite (Task 11).
 *
 * Connection rules:
 *  - credentials come from `backend/.env` (loaded by config/typeorm.datasource)
 *    and can be overridden wholesale with `TEST_DB_*`;
 *  - the database name NEVER falls back to the dev one: `TEST_DB_DATABASE`
 *    defaults to `vazhi_test`, so a misconfigured run cannot touch dev data;
 *  - `TEST_DB_SSL=true` reuses the dev TLS setting, otherwise tests connect
 *    plain (local/docker Postgres has no TLS).
 */

/** The suite only runs when explicitly opted in (double gate with jest config). */
export const integrationEnabled = process.env.INTEGRATION === '1';

type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

export function testDbOptions(): PostgresOptions {
  const base = dataSourceOptions as PostgresOptions;
  const database = process.env.TEST_DB_DATABASE ?? 'vazhi_test';
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Unsafe TEST_DB_DATABASE name: ${JSON.stringify(database)}`);
  }
  return {
    ...base,
    host: process.env.TEST_DB_HOST ?? base.host,
    port: Number(process.env.TEST_DB_PORT ?? base.port),
    username: process.env.TEST_DB_USERNAME ?? base.username,
    password: process.env.TEST_DB_PASSWORD ?? base.password,
    database,
    ssl: process.env.TEST_DB_SSL === 'true' ? base.ssl : false,
    synchronize: false, // schema comes from migrations only
    logging: false,
  };
}

/** Creates the throwaway database when it does not exist yet (docker's POSTGRES_DB normally does this). */
async function ensureDatabase(opts: PostgresOptions): Promise<void> {
  let admin: DataSource | undefined;
  try {
    admin = await new DataSource({ ...opts, database: 'postgres' }).initialize();
    const rows: Array<{ datname: string }> = await admin.query(
      'SELECT datname FROM pg_database WHERE datname = $1',
      [opts.database],
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${opts.database}"`);
    }
  } catch (e) {
    throw new Error(
      `Cannot create test database "${opts.database}" (${e instanceof Error ? e.message : String(e)}). ` +
        'Create it manually or start the stack with: docker compose -f docker-compose.test.yml up -d',
    );
  } finally {
    await admin?.destroy();
  }
}

// ---------------------------------------------------------------------------
// M-2 (pre-existing bug, discovered by this suite): fresh-DB migration repair
// ---------------------------------------------------------------------------
//
// The legacy auto-generated `SyncSchemaDrift1790972060287` migration re-ADDs
// columns that the backdated `1700000000200`/`0300`/`0400` migrations already
// create with `IF NOT EXISTS`, so `npm run migration:run` throws
// `column ... already exists` on EVERY fresh database. It only ever succeeded
// on the original dev DB, whose history recorded it before those files were
// backdated into the chain.
//
// Editing an existing migration is out of bounds for this pass, so the test
// bootstrap works around it without changing migration history:
//   1. run the chain (a fresh DB rolls back entirely — observed behaviour);
//   2. on that ONE known conflict, pre-mark SyncSchemaDrift as executed;
//   3. re-run the chain (every other migration still applies, all IF NOT EXISTS);
//   4. assert the skipped migration really was redundant — every column it
//      would have added exists (or was legitimately dropped later by
//      1791200002000) plus the `drivers.rating` default from InitSchema —
//      then mirror its last statement (clearing the avatar comment 0500 sets)
//      so the fresh end state matches dev exactly.
//
// Owner fix (blocked here by the no-migration-edits rule): make that
// migration idempotent (`ADD ... IF NOT EXISTS`) or delete its redundant
// statements, then verify `migration:run` on a fresh database.

const SYNC_SCHEMA_DRIFT = {
  name: 'SyncSchemaDrift1790972060287',
  timestamp: 1790972060287,
} as const;

/** Columns SyncSchemaDrift adds that must exist once the chain completes. */
const SYNC_COLUMNS_REQUIRED: ReadonlyArray<readonly [table: string, column: string]> = [
  ['users', 'profileComplete'],
  ['users', 'refreshTokenHash'],
  ['drivers', 'profilePhotoUrl'],
  ['drivers', 'carImageUrl'],
  ['drivers', 'drivingLicenceNumber'],
  ['drivers', 'drivingLicenceImageUrl'],
  ['drivers', 'rcNumber'],
  ['drivers', 'rcImageUrl'],
  // verificationStatus/verificationNote are intentionally absent here: this
  // chain adds them (0200/SyncSchemaDrift) and later drops them (1791200002000).
  ['drivers', 'status'],
  ['drivers', 'rejectionReason'],
  ['drivers', 'reviewedByUserId'],
  ['drivers', 'reviewedAt'],
  ['drivers', 'submittedAt'],
  ['drivers', 'licenseImagePath'],
  ['drivers', 'rcImagePath'],
  ['drivers', 'vehiclePhotoPath'],
];

function isSyncSchemaDriftConflict(e: unknown): boolean {
  return (
    e instanceof Error &&
    typeof e.stack === 'string' &&
    e.stack.includes(SYNC_SCHEMA_DRIFT.name)
  );
}

async function preMarkSyncSchemaDrift(ds: DataSource): Promise<void> {
  const rows: Array<{ name: string }> = await ds.query(
    'SELECT name FROM migrations WHERE name = $1',
    [SYNC_SCHEMA_DRIFT.name],
  );
  if (rows.length === 0) {
    await ds.query('INSERT INTO migrations (timestamp, name) VALUES ($1, $2)', [
      SYNC_SCHEMA_DRIFT.timestamp,
      SYNC_SCHEMA_DRIFT.name,
    ]);
  }
}

/** Post-condition of the pre-mark: skipping the migration left the correct schema. */
async function assertSyncSchemaDriftCoverage(ds: DataSource): Promise<void> {
  const literals = SYNC_COLUMNS_REQUIRED.map(([t, c]) => `('${t}', '${c}')`).join(', ');
  const found: Array<{ table_name: string; column_name: string }> = await ds.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND (table_name, column_name) IN (${literals})`,
  );
  const missing = SYNC_COLUMNS_REQUIRED.filter(
    ([t, c]) => !found.some((r) => r.table_name === t && r.column_name === c),
  );
  const ratingDefaults: Array<{ n: number }> = await ds.query(
    `SELECT COUNT(*)::int AS n
     FROM pg_attrdef d
     JOIN pg_class c ON c.oid = d.adrelid
     JOIN pg_namespace ns ON ns.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum
     WHERE ns.nspname = 'public' AND c.relname = 'drivers' AND a.attname = 'rating'`,
  );

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`missing columns: ${missing.map(([t, c]) => `${t}.${c}`).join(', ')}`);
  }
  if ((ratingDefaults[0]?.n ?? 0) === 0) {
    problems.push('drivers.rating has no DEFAULT');
  }
  if (problems.length > 0) {
    throw new Error(
      `M-2 repair rejected — ${SYNC_SCHEMA_DRIFT.name} is NOT redundant here ` +
        `(${problems.join('; ')}). Do not skip it; fix the migration chain instead.`,
    );
  }

  // Final statement of the skipped migration: it cleared the avatar comment
  // that 0500-AvatarFilename had set. Dev's end state has no comment, so
  // mirror it to keep fresh ≡ dev for future `migration:generate` runs.
  await ds.query(`COMMENT ON COLUMN "users"."avatar" IS NULL`);
}

async function runMigrationChain(ds: DataSource): Promise<void> {
  try {
    await ds.runMigrations();
    return;
  } catch (e) {
    if (!isSyncSchemaDriftConflict(e)) throw e;
  }
  // Known M-2 conflict. The failed batch rolled back, so retry from scratch
  // with only the redundant migration pre-marked as executed.
  await preMarkSyncSchemaDrift(ds);
  await ds.runMigrations();
  await assertSyncSchemaDriftCoverage(ds);
}

/** Initialized DataSource pointed at the test DB, full migration chain applied. */
export async function createTestDataSource(): Promise<DataSource> {
  const opts = testDbOptions();
  await ensureDatabase(opts);
  const ds = await new DataSource(opts).initialize();
  try {
    await runMigrationChain(ds);
  } catch (e) {
    await ds.destroy();
    throw e;
  }
  return ds;
}

/** Empty every table the suite touches (CASCADE resolves FK order). */
export async function wipeTestTables(ds: DataSource): Promise<void> {
  await ds.query(
    `TRUNCATE TABLE "promo_redemptions", "promos", "payments", "rides", "drivers", "admin_audit_logs", "saved_places", "users" RESTART IDENTITY CASCADE`,
  );
}
