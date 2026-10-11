import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SCHEMA_REPAIR_STATEMENTS } from './database/schema-repair';

// Columns/tables the booking + matching + payment paths hard-depend on. If any
// is missing, POST /rides (INSERT) fails with a bare HTTP 500 — so check at
// boot instead of leaving the rider staring at "Booking failed".
const REQUIRED_SCHEMA: Record<string, string[]> = {
  rides: ['offeredAt', 'offerExpiresAt', 'declinedDriverIds', 'otpAttempts', 'otpLockedUntil', 'paymentMarkedBy'],
  drivers: ['approvedAt', 'upiVpa', 'status'],
  promos: ['code', 'discountAmount', 'redemptionCount'],
  admin_audit_logs: ['action', 'targetId'],
  // SEC-2b: updateMe/googleSignIn write and read it — a drifted DB without
  // it 500s on PATCH /auth/me and on every Google sign-in.
  users: ['emailVerified'],
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

async function bootstrap() {
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
  // Pass-4 (task 4): warn, don't fail — the shipped APK still uses 4-digit
  // OTP entry, so a hard boot refusal would take the app offline. The risk
  // is real (10 guesses/hour/phone is ~2.4%/day per number with 4 digits),
  // and admin promotion at OTP login is already disabled for short codes.
  const otpLength = Number(config.get<string>('OTP_LENGTH') ?? 4);
  if (isProd && otpLength < 6) {
    // eslint-disable-next-line no-console
    console.warn(
      `[OTP] OTP_LENGTH=${otpLength} in production: phones with ${otpLength}-digit codes are ` +
        'brute-forceable (per-IP and per-phone caps limit the rate but not the risk), and admin ' +
        'promotion at OTP login is disabled for them. Set OTP_LENGTH=6 once the updated APK is out.',
    );
  }
  // CORS_ORIGIN may be "*" in dev, or a comma-separated allowlist in prod.
  const rawOrigin = config.get<string>('CORS_ORIGIN') ?? '*';
  const origin =
    rawOrigin === '*' ? (isProd ? false : '*') : rawOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin });
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
