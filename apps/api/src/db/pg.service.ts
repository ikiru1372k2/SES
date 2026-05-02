import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import type { SqlFragment } from './sql';
import { txStorage, currentTxClient } from './unit-of-work';

export interface QueryOptions {
  forceNewConnection?: boolean;
}

@Injectable()
export class PgService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgService.name);
  private pool!: Pool;

  async onModuleInit(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    this.pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10) });
    this.pool.on('error', (err) => this.logger.error(`pg pool error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
  }

  /** Run a query. Participates in the active transaction when one exists. */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: SqlFragment | string,
    values?: unknown[],
    options: QueryOptions = {},
  ): Promise<T[]> {
    const text = typeof sql === 'string' ? sql : sql.text;
    const params = typeof sql === 'string' ? values ?? [] : sql.values;
    const client = !options.forceNewConnection ? currentTxClient() : undefined;
    if (client) {
      const r = await client.query<T>(text, params);
      return r.rows;
    }
    const r = await this.pool.query<T>(text, params);
    return r.rows;
  }

  /** Run a single-row query, throwing if zero or more than one row is returned. */
  async one<T extends QueryResultRow = QueryResultRow>(
    sql: SqlFragment | string,
    values?: unknown[],
  ): Promise<T> {
    const rows = await this.query<T>(sql, values);
    if (rows.length !== 1) {
      throw new Error(`expected 1 row, got ${rows.length}`);
    }
    return rows[0]!;
  }

  /** Run a single-row query, returning undefined when no row matches. */
  async maybeOne<T extends QueryResultRow = QueryResultRow>(
    sql: SqlFragment | string,
    values?: unknown[],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, values);
    if (rows.length > 1) {
      throw new Error(`expected at most 1 row, got ${rows.length}`);
    }
    return rows[0];
  }

  /**
   * Run `fn` inside a transaction. Nested calls reuse the outer transaction
   * via AsyncLocalStorage so repository methods can be composed without
   * leaking BEGIN/COMMIT into the call site.
   */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const existing = currentTxClient();
    if (existing) return fn(existing);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await txStorage.run({ client }, () => fn(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
