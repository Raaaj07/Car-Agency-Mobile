import { DataSource, DataSourceOptions } from 'typeorm';
import { dataSourceOptions } from '../config/typeorm.datasource';
import { LOCAL_DB_HOSTS } from '../config/db-guard';

/**
 * Shared plumbing for the opt-in integration suite (Task 11).
 *
 * Connection rules:
 *  - credentials come from `backend/.env` (loaded by config/typeorm.datasource)
 *    and can be overridden wholesale with `TEST_DB_*`;
 *  - the database name NEVER falls back to the dev one: `TEST_DB_DATABASE`
 *    defaults to `vazhi_test`, so a misconfigured run cannot touch dev data;
 *  - pass 4: the resolved target must (a) look like a test database name,
 *    (b) differ from the dev DB_DATABASE and (c) be local unless
 *    TEST_DB_ALLOW_REMOTE=1 — checked in testDbOptions BEFORE connecting;
 *  - `TEST_DB_SSL=true` reuses the dev TLS setting, otherwise tests connect
 *    plain (local/docker Postgres has no TLS).
 */

/** The suite only runs when explicitly opted in (double gate with jest config). */
export const integrationEnabled = process.env.INTEGRATION === '1';

type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

export interface TestDbTarget {
  /** The database the suite would connect to. */
  database: string;
  /** The configured dev database (must never be selected). */
  baseDatabase: string;
  /** The resolved host. */
  host: string;
  /** TEST_DB_ALLOW_REMOTE === '1'. */
  allowRemote: boolean;
}

/**
 * Pure safety rule for the integration target (unit-tested in
 * db-helpers.spec.ts — no database involved). Returns the refusal message
 * or null when the target is acceptable.
 */
export function testDbTargetProblem(t: TestDbTarget): string | null {
  if (!/test/i.test(t.database)) {
    return `Unsafe TEST_DB_DATABASE "${t.database}" — the name must contain "test".`;
  }
  if (t.database === t.baseDatabase) {
    return 'TEST_DB_DATABASE equals DB_DATABASE — refusing to point the integration suite at the dev database.';
  }
  if (!t.allowRemote && !LOCAL_DB_HOSTS.has(t.host)) {
    return `TEST_DB_HOST "${t.host}" is not local — set TEST_DB_ALLOW_REMOTE=1 to allow a remote test database.`;
  }
  return null;
}

export function testDbOptions(): PostgresOptions {
  const base = dataSourceOptions as PostgresOptions;
  const database = process.env.TEST_DB_DATABASE ?? 'vazhi_test';
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Unsafe TEST_DB_DATABASE name: ${JSON.stringify(database)}`);
  }
  const host = process.env.TEST_DB_HOST ?? base.host ?? 'localhost';
  const problem = testDbTargetProblem({
    database,
    baseDatabase: base.database ?? '',
    host,
    allowRemote: process.env.TEST_DB_ALLOW_REMOTE === '1',
  });
  if (problem) throw new Error(problem);
  return {
    ...base,
    host,
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
// M-2: fresh-DB migration chain (regression guard)
// ---------------------------------------------------------------------------
//
// The legacy auto-generated `SyncSchemaDrift1790972060287` migration used to
// re-ADD columns that the backdated `1700000000200`/`0300`/`0400` migrations
// already create, so `migration:run` failed on EVERY fresh database. It is now
// idempotent (`ADD COLUMN IF NOT EXISTS`).
//
// There is deliberately NO repair fallback here: CI's `backend-integration`
// job runs this suite on an empty PostGIS database, and a non-idempotent
// migration must FAIL the build rather than be papered over.
async function runMigrationChain(ds: DataSource): Promise<void> {
  await ds.runMigrations();
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
