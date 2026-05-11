import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Pool, PoolClient } from 'pg';

const HERE = __dirname;
const MIGRATIONS_DIR = resolve(HERE, 'migrations');
const ADVISORY_LOCK_KEY = 7423619843509218271n;

const cwd = process.cwd();
for (const envPath of [resolve(cwd, '.env'), resolve(cwd, '..', '..', '.env')]) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath });
    break;
  }
}

interface RunnerOptions {
  dryRun: boolean;
  baseline: boolean;
  confirmBaseline: boolean;
}

function parseArgs(argv: string[]): RunnerOptions {
  return {
    dryRun: argv.includes('--dry-run'),
    baseline: argv.includes('--baseline'),
    confirmBaseline: argv.includes('--confirm-baseline') || process.env.SES_CONFIRM_DB_BASELINE === 'true',
  };
}

function listMigrationFiles(): { version: string; path: string; sql: string }[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const path = resolve(MIGRATIONS_DIR, name);
      return { version: basename(name, '.sql'), path, sql: readFileSync(path, 'utf8') };
    });
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      note        TEXT NOT NULL DEFAULT 'applied'
    )
  `);
}

async function appliedVersions(client: PoolClient): Promise<Set<string>> {
  const r = await client.query<{ version: string }>(`SELECT version FROM _schema_migrations`);
  return new Set(r.rows.map((row) => row.version));
}

async function applyMigration(
  pool: Pool,
  file: { version: string; sql: string },
  options: RunnerOptions,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY.toString()]);

    const ledgerCheck = await client.query<{ version: string }>(
      `SELECT version FROM _schema_migrations WHERE version = $1`,
      [file.version],
    );
    if (ledgerCheck.rowCount && ledgerCheck.rowCount > 0) {
      await client.query('COMMIT');
      return;
    }

    if (options.baseline) {
      await client.query(
        `INSERT INTO _schema_migrations (version, note) VALUES ($1, 'baseline')`,
        [file.version],
      );
      console.log(`[baseline] marked ${file.version}`);
    } else if (options.dryRun) {
      console.log(`[dry-run] would apply ${file.version} (${file.sql.length} bytes)`);
    } else {
      await client.query(file.sql);
      await client.query(
        `INSERT INTO _schema_migrations (version, note) VALUES ($1, 'applied')`,
        [file.version],
      );
      console.log(`[applied] ${file.version}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(options: RunnerOptions): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  if (options.baseline && !options.confirmBaseline) {
    throw new Error(
      'Refusing --baseline without --confirm-baseline or SES_CONFIRM_DB_BASELINE=true. Baseline marks migrations applied without running SQL.',
    );
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const init = await pool.connect();
    try {
      await ensureLedger(init);
    } finally {
      init.release();
    }

    const files = listMigrationFiles();
    if (files.length === 0) {
      console.log('No migrations found.');
      return;
    }

    const probe = await pool.connect();
    let already: Set<string>;
    try {
      already = await appliedVersions(probe);
    } finally {
      probe.release();
    }

    const pending = files.filter((f) => !already.has(f.version));
    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const file of pending) {
      await applyMigration(pool, file, options);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runMigrations(options).catch((err) => {
    console.error('migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
