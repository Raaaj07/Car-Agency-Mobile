/**
 * One-command database repair:  npm run db:repair
 *
 * Applies the idempotent statements in src/database/schema-repair.ts straight
 * to the database configured in backend/.env, regardless of which migrations
 * TypeORM thinks have run. Safe to re-run. Then prints a verification of the
 * columns that booking and driver matching depend on.
 */
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/config/typeorm.datasource';
import { SCHEMA_REPAIR_STATEMENTS } from '../src/database/schema-repair';

const REQUIRED: Record<string, string[]> = {
  rides: [
    'offeredAt',
    'offerExpiresAt',
    'declinedDriverIds',
    'otpAttempts',
    'otpLockedUntil',
    'paymentMarkedBy',
  ],
  drivers: ['approvedAt', 'upiVpa', 'status'],
  payments: ['status', 'providerOrderId'],
  promos: ['code', 'discountAmount', 'redemptionCount'],
};

async function main(): Promise<void> {
  // Plain connection: no entity/migration globbing needed for raw DDL.
  const ds = new DataSource({ ...dataSourceOptions, entities: [], migrations: [], synchronize: false });
  await ds.initialize();
  const runner = ds.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    for (const sql of SCHEMA_REPAIR_STATEMENTS) {
      await runner.query(sql);
    }
    await runner.commitTransaction();
    console.log(`Applied ${SCHEMA_REPAIR_STATEMENTS.length} idempotent statements.`);

    let missing = 0;
    for (const [table, cols] of Object.entries(REQUIRED)) {
      const rows: Array<{ column_name: string }> = await runner.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table],
      );
      const have = new Set(rows.map((r) => r.column_name));
      for (const c of cols) {
        const ok = have.has(c);
        if (!ok) missing += 1;
        console.log(`${ok ? 'OK     ' : 'MISSING'} ${table}.${c}`);
      }
    }
    const widths: Array<{ table_name: string; column_name: string; character_maximum_length: number }> =
      await runner.query(
        `SELECT table_name, column_name, character_maximum_length
         FROM information_schema.columns
         WHERE (table_name = 'rides' AND column_name = 'paymentStatus')
            OR (table_name = 'payments' AND column_name = 'status')`,
      );
    for (const w of widths) {
      console.log(`WIDTH   ${w.table_name}.${w.column_name} = varchar(${w.character_maximum_length})`);
    }
    if (missing > 0) {
      console.error(`\n${missing} required column(s) still missing — check the output above.`);
      process.exitCode = 1;
    } else {
      console.log('\nSchema is up to date. Restart the backend.');
    }
  } catch (err) {
    await runner.rollbackTransaction().catch(() => undefined);
    console.error('Schema repair FAILED (rolled back):', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await runner.release();
    await ds.destroy();
  }
}

void main();
