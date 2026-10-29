import 'reflect-metadata';
import { setDefaultResultOrder } from 'node:dns';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SCHEMA_REPAIR_STATEMENTS } from './database/schema-repair';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';

// Prefer IPv4 for every outbound connection (DB, Redis, Google, Wikipedia).
// On many Windows/home networks the IPv6 route is dead, and Node then tries
// each address in turn and fails with `AggregateError [ETIMEDOUT]` — which
// surfaced as random 500s (and empty home lists) for whoever's request hit it.
setDefaultResultOrder('ipv4first');

// Columns/tables the booking + matching + payment paths hard-depend on. If any
// is missing, POST /rides (INSERT) fails with a bare HTTP 500 — so check at
// boot instead of leaving the rider staring at "Booking failed".
const REQUIRED_SCHEMA: Record<string, string[]> = {
  rides: [
    'offeredAt',
    'offerExpiresAt',
    'declinedDriverIds',
    'otpAttempts',
    'otpLockedUntil',
    'paymentMarkedBy',
    'shareTokenHash',
    'sosAt',
    'ratingComment',
  ],
  refresh_sessions: ['userId', 'tokenHash', 'previousTokenHash', 'revokedAt'],
  device_tokens: ['userId', 'token'],
  drivers: ['approvedAt', 'upiVpa', 'status'],
  promos: ['code', 'discountAmount', 'redemptionCount'],
  admin_audit_logs: ['action', 'targetId'],
  // Admin-editable driver search radius (reads fall back to 10 km without it,
  // but saving the setting needs the table).
  app_settings: ['key', 'value'],
  // SEC-2b: updateMe/googleSignIn write and read it — a drifted DB without
  // it 500s on PATCH /auth/me and on every Google sign-in.
  users: ['emailVerified', 'emergencyContactPhone', 'pushEnabled'],
};

async function findSchemaProblems(ds: DataSource): Promise<string[]> {
  const problems: string[] = [];
  for (const [table, cols] of Object.entries(REQUIRED_SCHEMA)) {
    const rows: Array<{ column_name: string }> = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table],
    );
    if (rows.length === 0) {
      problems.push(`table "${table}" does not exist`);
      continue;
    }
    const have = new Set(rows.map((r) => r.column_name));
    const missing = cols.filter((c) => !have.has(c));
    if (missing.length) problems.push(`${table}: missing ${missing.join(', ')}`);
  }
  // 'rider_claimed' is 13 chars; the original varchar(10) rejects it.
  const widths: Array<{ table_name: string; len: number | null }> = await ds.query(
    `SELECT table_name, character_maximum_length AS len FROM information_schema.columns
     WHERE (table_name = 'rides' AND column_name = 'paymentStatus')
        OR (table_name = 'payments' AND column_name = 'status')`,
  );
  for (const w of widths) {
    if (w.len !== null && w.len < 13) {
      problems.push(`${w.table_name} status column is varchar(${w.len}); 'rider_claimed' needs >= 13`);
    }
  }
  // SEC-4: without this index a DB silently allows double bookings again —
  // create()'s count() pre-check is race-prone by design (only the partial
  // unique index closes the race).
  const guard: Array<{ indexname: string }> = await ds.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'rides' AND indexname = 'UQ_rides_active_per_rider'`,
  );
  if (guard.length === 0) {
    problems.push('rides: missing unique index UQ_rides_active_per_rider (one active ride per rider)');
  }
  return problems;
}

/**
 * Verifies the DB matches the code, BEFORE the server takes traffic.
 * In development the idempotent repair is applied automatically
 * (DB_AUTO_REPAIR=false disables it); in production it only reports.
 * Returns the problems that remain AFTER any repair:
 *  - empty array → schema is fine, start normally;
 *  - non-empty → the caller decides (production exits, dev warns).
 */
async function findSchemaForBoot(app: INestApplication, autoRepair: boolean): Promise<string[]> {
  try {
    const ds = app.get(DataSource);
    let problems = await findSchemaProblems(ds);
    if (problems.length === 0) return [];

    // eslint-disable-next-line no-console
    console.error('\n[SCHEMA] Database does not match the code:\n  - ' + problems.join('\n  - '));
    if (!autoRepair) {
      // eslint-disable-next-line no-console
      console.error('[SCHEMA] Fix: run `npm run db:repair` in backend/ (or apply the migration), then start again.\n');
      return problems;
    }

    // eslint-disable-next-line no-console
    console.warn('[SCHEMA] Applying idempotent repair automatically (dev)...');
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      for (const sql of SCHEMA_REPAIR_STATEMENTS) await runner.query(sql);
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction().catch(() => undefined);
      throw err;
    } finally {
      await runner.release();
    }
    problems = await findSchemaProblems(ds);
    if (problems.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[SCHEMA] Repair applied — database now matches the code.\n');
    } else {
      // eslint-disable-next-line no-console
      console.error('[SCHEMA] Still mismatched after repair:\n  - ' + problems.join('\n  - ') + '\n');
    }
    return problems;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[SCHEMA] Could not verify/repair schema: ${(err as Error).message}`);
    // Production fails closed: an UNVERIFIED schema must not take traffic.
    // Development keeps the old behaviour (warn and start).
    return autoRepair ? [] : [`schema check failed: ${(err as Error).message}`];
  }
}

// Optional error reporting. Inert unless SENTRY_DSN is set AND @sentry/node is
// installed (`npm i @sentry/node`) — never a hard dependency, never fatal.
// Exported so the exception filter can report 5xx without importing Sentry.
function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: 0,
      // Never ship request bodies / headers (OTPs, tokens, phone numbers).
      sendDefaultPii: false,
    });
    (globalThis as { __sentry?: unknown }).__sentry = Sentry;
    // eslint-disable-next-line no-console
    console.log('[sentry] error reporting enabled');
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[sentry] SENTRY_DSN is set but @sentry/node is not installed — reporting disabled');
  }
}

async function bootstrap() {
  initSentry();
  // Pass-4 (task 5): rawBody keeps the exact bytes of every request so the
  // Razorpay webhook can verify its HMAC signature over what was sent (a
  // re-serialized JSON body would re-order keys and break the signature).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const isProd = (config.get<string>('NODE_ENV') ?? 'development') === 'production';

  app.setGlobalPrefix(config.get<string>('API_PREFIX') ?? 'api/v1', {
    // Pass-4 (task 9): keep /health at the root so the platform / load
    // balancer can probe it without knowing the API prefix.
    exclude: ['health'],
  });
  // AU-1: baseline security headers (CSP/HSTS/frame options etc.) — harmless
  // for a JSON API, meaningful for any HTML/error pages it might serve.
  app.use(helmet());
  // SEC-5: correct client IP for rate limiting (ThrottlerGuard keys on req.ip).
  // Default off: if the port is directly reachable, trusting X-Forwarded-For
  // would let attackers spoof a fresh IP per request and bypass the OTP /
  // refresh throttles entirely. TRUST_PROXY=true trusts exactly one proxy hop.
  const trustProxy = (config.get<string>('TRUST_PROXY') ?? 'false') === 'true';
  if (trustProxy) {
    const httpAdapter = app.getHttpAdapter().getInstance() as {
      set(setting: string, value: number): unknown;
    };
    httpAdapter.set('trust proxy', 1);
  } else if (isProd) {
    // SEC-5: loud on purpose. Behind a proxy with this off, req.ip is the
    // PROXY address for every caller — all anonymous traffic (OTP sends,
    // social sign-in, photo streams) then shares ONE rate-limit bucket, so
    // the eleventh user in any 10 minutes gets a 429 that is not their
    // fault, and audit rows blame the proxy. The fix is one env var.
    // eslint-disable-next-line no-console
    console.warn(
      '[SEC-5] TRUST_PROXY is not "true" in production. If a reverse proxy / load ' +
        "balancer (Render, nginx) sits in front of this app, every caller shares the proxy's " +
        'IP: anonymous rate limits collide across ALL users and audit logs record the proxy ' +
        'address. Set TRUST_PROXY=true (trusts exactly one hop) — unless the port is directly ' +
        'reachable, in which case keep it false so X-Forwarded-For cannot be spoofed.',
    );
  }
  // Task 9: OTP_LENGTH defaults to 6 in production. Refuse < 6 without ALLOW_4_DIGIT_OTP=true.
  const allow4Digit = (config.get<string>('ALLOW_4_DIGIT_OTP') ?? 'false') === 'true';
  const rawOtpLen = config.get<string>('OTP_LENGTH');
  const otpLength = Number(rawOtpLen ?? (isProd && !allow4Digit ? 6 : 4));
  if (isProd && otpLength < 6) {
    if (allow4Digit) {
      // eslint-disable-next-line no-console
      console.warn(
        `[OTP] WARNING: ALLOW_4_DIGIT_OTP=true is enabled in production! Phones will receive 4-digit codes. ` +
          '4-digit codes are vulnerable to brute force. Set OTP_LENGTH=6 once all clients are updated.',
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[OTP] ERROR: OTP_LENGTH=${otpLength} in production is insecure and refused without ALLOW_4_DIGIT_OTP=true.`,
      );
    }
  }
  // CORS_ORIGIN may be "*" in dev, or a comma-separated allowlist in prod.
  const rawOrigin = config.get<string>('CORS_ORIGIN') ?? '*';
  const origin =
    rawOrigin === '*' ? (isProd ? false : '*') : rawOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin });

  // Task 6: Socket.IO Redis adapter for multi-instance realtime scaling
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(config);
  app.useWebSocketAdapter(redisIoAdapter);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  // Pass-4 (task 9): verify the schema BEFORE app.listen. A wrong-schema
  // server would accept traffic and then 500 on every ride INSERT / payment
  // read, so in production a mismatch is fatal; development keeps the
  // idempotent auto-repair below.
  const autoRepair = !isProd && (config.get<string>('DB_AUTO_REPAIR') ?? 'true') !== 'false';
  const schemaProblems = await findSchemaForBoot(app, autoRepair);
  if (schemaProblems.length > 0 && isProd) {
    // eslint-disable-next-line no-console
    console.error(
      `[SCHEMA] Refusing to start: database does not match the code —\n  - ${schemaProblems.join('\n  - ')}`,
    );
    // eslint-disable-next-line no-console
    console.error('[SCHEMA] Fix: run `npm run db:repair` in backend/ (or apply the migration), then restart.\n');
    // Immediate exit — closing gracefully could hang on a broken DB pool.
    process.exit(1);
  }
  if (schemaProblems.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[SCHEMA] Starting anyway (development): ${schemaProblems.length} problem(s) remain — see above.`,
    );
  }

  const port = Number(config.get<string>('PORT') ?? 3000);
  await app.listen(port);
  // Pass-4 (task 9): slowloris protection — a request must complete within
  // 30 s and headers arrive within 35 s, so a stalled peer cannot hold a
  // connection (and its worker) open indefinitely.
  const server = app.getHttpServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  // eslint-disable-next-line no-console
  console.log(`Vazhi backend listening on :${port}`);
}

bootstrap();
