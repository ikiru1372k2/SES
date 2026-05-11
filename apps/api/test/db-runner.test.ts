import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { Pool } from 'pg';
import { runMigrations } from '../db/runner';

// Gate behind explicit opt-in: this suite drops and recreates the public
// schema, which races other DB-bound tests under parallel test execution.
// CI can set DB_RESET_ALLOWED=1 in a dedicated job; local runs leave it off.
const hasDb = Boolean(process.env.DATABASE_URL);
const allowReset = process.env.DB_RESET_ALLOWED === '1';

describe('db migrator', { skip: !hasDb || !allowReset }, () => {
  let pool: Pool;

  before(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  after(async () => {
    await pool.end();
  });

  it('creates the ledger and applies on a fresh DB', async () => {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');

    await runMigrations({ dryRun: false, baseline: false, confirmBaseline: false });

    const ledger = await pool.query<{ version: string; note: string }>(
      `SELECT version, note FROM _schema_migrations ORDER BY version`,
    );
    assert.ok(ledger.rowCount! >= 2, 'expected 0001 and 0002 to be applied');
    assert.equal(
      ledger.rows.every((r) => r.note === 'applied'),
      true,
    );

    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_pilot_job'`,
    );
    assert.equal(tables.rowCount, 1);
  });

  it('is idempotent — re-running is a no-op', async () => {
    const before = await pool.query<{ version: string }>(
      `SELECT version FROM _schema_migrations ORDER BY version`,
    );
    await runMigrations({ dryRun: false, baseline: false, confirmBaseline: false });
    const after = await pool.query<{ version: string }>(
      `SELECT version FROM _schema_migrations ORDER BY version`,
    );
    assert.deepEqual(
      before.rows.map((r) => r.version),
      after.rows.map((r) => r.version),
    );
  });

  it('--baseline marks all on-disk migrations as applied without running DDL', async () => {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');

    await runMigrations({ dryRun: false, baseline: true, confirmBaseline: true });

    const ledger = await pool.query<{ version: string; note: string }>(
      `SELECT version, note FROM _schema_migrations ORDER BY version`,
    );
    assert.ok(ledger.rowCount! >= 2);
    assert.equal(
      ledger.rows.every((r) => r.note === 'baseline'),
      true,
    );

    const userTable = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'User'`,
    );
    assert.equal(userTable.rowCount, 0, '--baseline must not execute migration DDL');
  });
});
