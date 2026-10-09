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
  return problems;
}

/**
 * Verifies the DB matches the code. In development the idempotent repair is
 * applied automatically (DB_AUTO_REPAIR=false disables it); in production it
 * only reports — run `npm run db:repair` deliberately there.
 */
async function ensureSchema(app: INestApplication, autoRepair: boolean): Promise<void> {
  try {
    const ds = app.get(DataSource);
    let problems = await findSchemaProblems(ds);
    if (problems.length === 0) return;

    // eslint-disable-next-line no-console
    console.error('\n[SCHEMA] Database does not match the code:\n  - ' + problems.join('\n  - '));
    if (!autoRepair) {
      // eslint-disable-next-line no-console
      console.error('[SCHEMA] Fix: stop the server, run `npm run db:repair` in backend/, then start again.\n');
      return;
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[SCHEMA] Could not verify/repair schema: ${(err as Error).message}`);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProd = (config.get<string>('NODE_ENV') ?? 'development') === 'production';

  app.setGlobalPrefix(config.get<string>('API_PREFIX') ?? 'api/v1');
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

  const port = Number(config.get<string>('PORT') ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Vazhi backend listening on :${port}`);
  const autoRepair = !isProd && (config.get<string>('DB_AUTO_REPAIR') ?? 'true') !== 'false';
  await ensureSchema(app, autoRepair);
}

bootstrap();
