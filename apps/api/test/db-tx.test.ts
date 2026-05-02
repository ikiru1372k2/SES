import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { PgService } from '../src/db/pg.service';
import { sql } from '../src/db/sql';

const hasDb = Boolean(process.env.DATABASE_URL);

async function makeService(): Promise<PgService> {
  const svc = new PgService();
  await svc.onModuleInit();
  return svc;
}

describe('PgService.tx', { skip: !hasDb }, () => {
  let svc: PgService;

  before(async () => {
    svc = await makeService();
    await svc.query(`CREATE TABLE IF NOT EXISTS _tx_test (k TEXT PRIMARY KEY, v INT)`);
    await svc.query(`TRUNCATE _tx_test`);
  });
  after(async () => {
    await svc.query(`DROP TABLE IF EXISTS _tx_test`);
    await svc.onModuleDestroy();
  });

  it('commits when the callback resolves', async () => {
    await svc.tx(async () => {
      await svc.query(sql`INSERT INTO _tx_test (k, v) VALUES (${'a'}, ${1})`);
      await svc.query(sql`INSERT INTO _tx_test (k, v) VALUES (${'b'}, ${2})`);
    });
    const rows = await svc.query<{ k: string; v: number }>(
      sql`SELECT k, v FROM _tx_test ORDER BY k`,
    );
    assert.deepEqual(rows, [
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
    ]);
  });

  it('rolls back when the callback throws', async () => {
    await svc.query(`TRUNCATE _tx_test`);
    await assert.rejects(
      svc.tx(async () => {
        await svc.query(sql`INSERT INTO _tx_test (k, v) VALUES (${'x'}, ${10})`);
        throw new Error('boom');
      }),
    );
    const rows = await svc.query(`SELECT * FROM _tx_test`);
    assert.equal(rows.length, 0);
  });

  it('nested tx() reuses the outer transaction (single rollback)', async () => {
    await svc.query(`TRUNCATE _tx_test`);
    await assert.rejects(
      svc.tx(async () => {
        await svc.query(sql`INSERT INTO _tx_test (k, v) VALUES (${'outer'}, ${1})`);
        await svc.tx(async () => {
          await svc.query(sql`INSERT INTO _tx_test (k, v) VALUES (${'inner'}, ${2})`);
          throw new Error('inner-boom');
        });
      }),
    );
    const rows = await svc.query(`SELECT * FROM _tx_test`);
    assert.equal(rows.length, 0, 'inner throw must roll back the outer transaction too');
  });
});

describe('sql tagged template', () => {
  it('numbers parameters and pulls values', () => {
    const f = sql`SELECT * FROM t WHERE a = ${1} AND b = ${'x'}`;
    assert.equal(f.text, 'SELECT * FROM t WHERE a = $1 AND b = $2');
    assert.deepEqual(f.values, [1, 'x']);
  });

  it('composes nested fragments with offset parameters', () => {
    const inner = sql`a = ${1}`;
    const outer = sql`SELECT * FROM t WHERE ${inner} AND b = ${'y'}`;
    assert.equal(outer.text, 'SELECT * FROM t WHERE a = $1 AND b = $2');
    assert.deepEqual(outer.values, [1, 'y']);
  });
});
