/**
 * SEC-11: ONE definition of the Postgres SSL policy, shared by the runtime
 * datasource (app.module via ConfigService) and the migration CLI
 * (typeorm.datasource via process.env). Before, only the CLI honoured
 * DB_SSL_REJECT_UNAUTHORIZED — the app decided by NODE_ENV alone, so the two
 * paths could silently disagree (a managed DB that needs
 * rejectUnauthorized=false reachable via `migration:run` but not by the app,
 * or the reverse).
 */
export type DbSslPolicy = false | { rejectUnauthorized: boolean };

export function resolveDbSsl(env: {
  DB_SSL?: string;
  DB_SSL_REJECT_UNAUTHORIZED?: string;
  NODE_ENV?: string;
}): DbSslPolicy {
  // DB_SSL=false disables TLS entirely (plain local dev).
  if ((env.DB_SSL ?? 'true') === 'false') return false;
  // Otherwise verify the server cert unless explicitly told not to:
  // strict by default in production, relaxed for local development.
  const defaultReject = (env.NODE_ENV ?? 'development') === 'production' ? 'true' : 'false';
  const reject = (env.DB_SSL_REJECT_UNAUTHORIZED ?? defaultReject) === 'true';
  return { rejectUnauthorized: reject };
}
