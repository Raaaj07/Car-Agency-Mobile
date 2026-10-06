import { DataSource } from 'typeorm';
import { createTestDataSource, integrationEnabled, wipeTestTables } from './db-helpers';

/**
 * Task 11 — schema fidelity: the migration chain alone must produce every
 * column the entities write to. Dev silently satisfies this via
 * `DB_SYNCHRONIZE=true` drift (finding M-3), so a fresh production database
 * would fail INSERTs even with M-2 repaired. This test makes that gap
 * impossible to reintroduce unnoticed.
 * Opt-in only: `INTEGRATION=1 npm run test:integration`.
 */
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('migration-produced schema covers every entity column (INTEGRATION=1)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await wipeTestTables(ds);
  });

  it('has no entity column missing from the migrated schema', async () => {
    const gaps: string[] = [];

    for (const meta of ds.entityMetadatas) {
      const rows: Array<{ column_name: string }> = await ds.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [meta.tableName],
      );
      const present = new Set(rows.map((r) => r.column_name));
      for (const col of meta.columns) {
        if (!present.has(col.databaseName)) {
          gaps.push(`${meta.tableName}.${col.databaseName}`);
        }
      }
    }

    expect(gaps).toEqual([]);
  });

  it('keeps every FK/index the entities declare (spot-check: promo_redemptions SET NULL)', async () => {
    const rows: Array<{ confdeltype: string }> = await ds.query(
      `SELECT rc.confdeltype
       FROM pg_constraint rc
       JOIN pg_class c ON c.oid = rc.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'promo_redemptions'
         AND rc.contype = 'f'
         AND rc.conname LIKE '%promo%'`,
    );
    // 'a' = NO ACTION, 'c' = CASCADE, 'n' = SET NULL
    expect(rows.map((r) => r.confdeltype)).toContain('n');
  });
});
