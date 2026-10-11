import { dataSourceOptions } from './typeorm.datasource';

/**
 * Dev/prod database isolation guard (pass 4, task 1).
 *
 * The laptop and the Render deployment must never share a database. Until
 * the owner separates them, every one-off script calls
 * `assertSafeForScript` BEFORE opening a connection so a dev command
 * cannot change or destroy real data:
 *
 *   - NODE_ENV=production           → always refused;
 *   - a non-local DB host           → refused unless the script is started
 *     with REMOTE_DB_FLAG, and — when the script is destructive —
 *     ALLOW_REMOTE_DB_WRITES=true as well.
 *
 * The refusal message names only the host and the override flag(s): never
 * the username, password or database name.
 */

/** Hostnames that are always "this machine" / the docker-compose stack. */
export const LOCAL_DB_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'db',
]);

/** Command-line acknowledgement required to point a script at a remote DB. */
export const REMOTE_DB_FLAG = '--i-understand-this-is-a-remote-database';

export interface ScriptSafetyInput {
  /** true for scripts that write rows (seed, unseed, repair, …). */
  destructive: boolean;
  /** The DB host from dataSourceOptions (never the password). */
  host: string;
  nodeEnv: string | undefined;
  /** process.argv — checked for REMOTE_DB_FLAG. */
  argv: readonly string[];
  /** process.env.ALLOW_REMOTE_DB_WRITES ('true' only when explicitly set). */
  allowRemoteWrites?: string | undefined;
}

/**
 * Pure refusal rule: returns the error message, or null when the script
 * may run. Unit-tested in db-guard.spec.ts — no database is touched.
 *
 * Production is refused unconditionally: the override flags exist to let a
 * developer acknowledge a REMOTE database from a laptop, never to let a
 * script run inside a production environment.
 */
export function scriptSafetyProblem(input: ScriptSafetyInput): string | null {
  if ((input.nodeEnv ?? 'development') === 'production') {
    return `Refusing to run: NODE_ENV=production (DB host "${input.host}").`;
  }
  if (LOCAL_DB_HOSTS.has(input.host)) return null;

  if (!input.argv.includes(REMOTE_DB_FLAG)) {
    return (
      `Refusing to run: DB host "${input.host}" is not a local database. ` +
      `Re-run with ${REMOTE_DB_FLAG} if you really mean it.` +
      (input.destructive ? ' Destructive scripts also need ALLOW_REMOTE_DB_WRITES=true.' : '')
    );
  }
  if (input.destructive && input.allowRemoteWrites !== 'true') {
    return (
      `Refusing to run a destructive script against DB host "${input.host}": ` +
      `set ALLOW_REMOTE_DB_WRITES=true together with ${REMOTE_DB_FLAG}.`
    );
  }
  return null;
}

/**
 * Call at the top of every script under src/database/scripts/, the seed
 * and the backend/scripts utilities. Prints the refusal and exits 1
 * (before any connection is opened) when the target is unsafe.
 */
export function assertSafeForScript(opts: { destructive: boolean }): void {
  // Narrowed instead of importing PostgresConnectionOptions: the app only
  // ever builds a postgres datasource (config/typeorm.datasource.ts).
  const host = (dataSourceOptions as { host?: string }).host ?? 'localhost';
  const problem = scriptSafetyProblem({
    destructive: opts.destructive,
    host,
    nodeEnv: process.env.NODE_ENV,
    argv: process.argv,
    allowRemoteWrites: process.env.ALLOW_REMOTE_DB_WRITES,
  });
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
