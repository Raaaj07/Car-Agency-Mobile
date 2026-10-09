/// <reference types="jest" />
import { resolveDbSsl } from './db-ssl';

/**
 * SEC-11: one SSL policy for the runtime app AND the migration CLI. The app
 * used to decide by NODE_ENV alone while the CLI honoured
 * DB_SSL_REJECT_UNAUTHORIZED — the two paths could disagree about how to
 * reach the same database.
 */
describe('resolveDbSsl (SEC-11 — shared app/CLI Postgres SSL policy)', () => {
  it('DB_SSL=false disables TLS regardless of everything else', () => {
    expect(resolveDbSsl({ DB_SSL: 'false', NODE_ENV: 'production' })).toBe(false);
    expect(resolveDbSsl({ DB_SSL: 'false' })).toBe(false);
  });

  it('defaults to strict verification in production', () => {
    expect(resolveDbSsl({ NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: true });
  });

  it('defaults to relaxed verification outside production (local dev DBs)', () => {
    expect(resolveDbSsl({})).toEqual({ rejectUnauthorized: false });
    expect(resolveDbSsl({ NODE_ENV: 'development' })).toEqual({ rejectUnauthorized: false });
  });

  it('honours the explicit override in production (managed-DB escape hatch)', () => {
    expect(
      resolveDbSsl({ NODE_ENV: 'production', DB_SSL_REJECT_UNAUTHORIZED: 'false' }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('honours the explicit override outside production (strict dev CA)', () => {
    expect(resolveDbSsl({ DB_SSL_REJECT_UNAUTHORIZED: 'true' })).toEqual({
      rejectUnauthorized: true,
    });
  });
});
