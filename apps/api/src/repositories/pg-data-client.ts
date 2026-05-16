/**
 * pg-backed data client. Compiles the argument shapes the existing
 * service layer was already using (where/include/select/orderBy/take/skip,
 * create/update/upsert/delete/count/aggregate/groupBy, $transaction)
 * into plain SQL executed by `pg`.
 *
 * The schema authority is `apps/api/db/migrations/*.sql`. This file
 * never generates schema — it only translates query shapes into SQL
 * against tables described in `schema-map.ts`.
 */

import type { Pool, PoolClient, QueryResult } from 'pg';
import { MODELS, ModelMeta } from './schema-map';

interface QueryRunner {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

const QC = (col: string): string => `"${col}"`;
const QT = (table: string): string => `"${table}"`;

interface CompileCtx {
  meta: ModelMeta;
  alias: string;
  joins: string[];
  /** Per-query counter — each top-level call initialises this to 0 so
   *  concurrent requests never share alias numbering. */
  aliasSeq: { n: number };
}

function nextParam(values: unknown[], v: unknown): string {
  values.push(v);
  return `$${values.length}`;
}

interface IncludeSpec {
  [key: string]:
    | boolean
    | {
        include?: IncludeSpec;
        select?: Record<string, unknown>;
        orderBy?: unknown;
        where?: Record<string, unknown>;
        take?: number;
        skip?: number;
      };
}

// --- where -------------------------------------------------------------------

function compileConditions(
  where: Record<string, unknown>,
  ctx: CompileCtx,
  values: unknown[],
): string[] {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(where)) {
    if (raw === undefined) continue;

    if (key === 'AND') {
      const arr = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
      const sub = arr.flatMap((w) => compileConditions(w, ctx, values));
      if (sub.length) parts.push(`(${sub.join(' AND ')})`);
      continue;
    }
    if (key === 'OR') {
      const arr = raw as Record<string, unknown>[];
      const sub = arr
        .map((w) => compileConditions(w, ctx, values))
        .filter((p) => p.length > 0)
        .map((p) => `(${p.join(' AND ')})`);
      if (sub.length) parts.push(`(${sub.join(' OR ')})`);
      continue;
    }
    if (key === 'NOT') {
      const inner = compileConditions(raw as Record<string, unknown>, ctx, values);
      if (inner.length) parts.push(`NOT (${inner.join(' AND ')})`);
      continue;
    }

    // Composite-key shorthand `where: { a_b: { a, b } }` — only when the
    // value is an object; single-column unique aliases fall through below.
    if (
      ctx.meta.uniques[key] &&
      raw !== null &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      !(raw instanceof Date) &&
      !Buffer.isBuffer(raw)
    ) {
      const cols = ctx.meta.uniques[key];
      // If the shape lacks any composite column, treat as an operator object.
      const obj = raw as Record<string, unknown>;
      const looksLikeComposite = cols.every((c) => c in obj);
      if (looksLikeComposite) {
        const seg: string[] = [];
        for (const c of cols) {
          const v = obj[c];
          if (v === null || v === undefined) {
            seg.push(`${ctx.alias}.${QC(c)} IS NULL`);
          } else {
            seg.push(`${ctx.alias}.${QC(c)} = ${nextParam(values, v)}`);
          }
        }
        parts.push(`(${seg.join(' AND ')})`);
        continue;
      }
    }

    // Relation filter (correlated EXISTS / NOT EXISTS).
    //
    // Many-relations support Prisma's `some` / `every` / `none` wrappers:
    //   members: { some:  { userId } }    -> EXISTS … WHERE …
    //   members: { every: { isActive } }  -> NOT EXISTS … WHERE NOT (…)
    //   members: { none:  { userId } }    -> NOT EXISTS … WHERE …
    // One-relations may use a bare `{ userId }` filter or the same `is` /
    // `isNot` shorthands.
    const rel = ctx.meta.relations[key];
    if (
      rel &&
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      !(raw instanceof Date) &&
      !Buffer.isBuffer(raw)
    ) {
      const relMeta = MODELS[rel.target]!;
      // Counter-suffixed alias so nested relation filters don't collide.
      const subAlias = `r_${key}_${++ctx.aliasSeq.n}`;
      const localKey = rel.localKey ?? ctx.meta.id[0]!;
      const fk =
        rel.foreignKey ??
        `${ctx.meta.model.charAt(0).toLowerCase() + ctx.meta.model.slice(1)}Id`;
      const join =
        rel.kind === 'one'
          ? `${ctx.alias}.${QC(localKey)} = ${subAlias}.${QC(rel.foreignKey ?? relMeta.id[0]!)}`
          : `${ctx.alias}.${QC(localKey)} = ${subAlias}.${QC(fk)}`;

      // Relation-filter wrapper: apply inner conditions to the related table
      // directly (re-entering the relation resolver would loop).
      const wrap = raw as Record<string, unknown>;
      let mode: 'some' | 'every' | 'none' | 'is' | 'isNot' | 'direct' = 'direct';
      let inner: Record<string, unknown> | undefined;
      if ('some' in wrap || 'every' in wrap || 'none' in wrap || 'is' in wrap || 'isNot' in wrap) {
        if ('some' in wrap) {
          mode = 'some';
          inner = (wrap.some as Record<string, unknown>) ?? {};
        } else if ('every' in wrap) {
          mode = 'every';
          inner = (wrap.every as Record<string, unknown>) ?? {};
        } else if ('none' in wrap) {
          mode = 'none';
          inner = (wrap.none as Record<string, unknown>) ?? {};
        } else if ('is' in wrap) {
          mode = 'is';
          inner = (wrap.is as Record<string, unknown>) ?? {};
        } else {
          mode = 'isNot';
          inner = (wrap.isNot as Record<string, unknown>) ?? {};
        }
      } else {
        inner = wrap;
      }

      const subCtx: CompileCtx = {
        meta: relMeta,
        alias: subAlias,
        joins: ctx.joins,
        aliasSeq: ctx.aliasSeq,
      };
      const innerParts = compileConditions(inner ?? {}, subCtx, values);
      const innerSql = innerParts.length ? `AND ${innerParts.join(' AND ')}` : '';
      const exists = `EXISTS (SELECT 1 FROM ${QT(relMeta.table)} ${subAlias} WHERE ${join} ${innerSql})`;
      const notExistsViolation = innerParts.length
        ? `NOT EXISTS (SELECT 1 FROM ${QT(relMeta.table)} ${subAlias} WHERE ${join} AND NOT (${innerParts.join(' AND ')}))`
        : exists;
      const notExists = `NOT EXISTS (SELECT 1 FROM ${QT(relMeta.table)} ${subAlias} WHERE ${join} ${innerSql})`;

      switch (mode) {
        case 'every':
          parts.push(notExistsViolation);
          break;
        case 'none':
        case 'isNot':
          parts.push(notExists);
          break;
        default:
          parts.push(exists);
      }
      continue;
    }

    const colExpr = `${ctx.alias}.${QC(key)}`;

    if (raw === null) {
      parts.push(`${colExpr} IS NULL`);
      continue;
    }

    if (
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      !(raw instanceof Date) &&
      !Buffer.isBuffer(raw)
    ) {
      const op = raw as Record<string, unknown>;
      const segs: string[] = [];
      for (const [k, v] of Object.entries(op)) {
        if (v === undefined) continue;
        switch (k) {
          case 'equals':
            if (v === null) segs.push(`${colExpr} IS NULL`);
            else segs.push(`${colExpr} = ${nextParam(values, v)}`);
            break;
          case 'not':
            if (v === null) segs.push(`${colExpr} IS NOT NULL`);
            else segs.push(`${colExpr} <> ${nextParam(values, v)}`);
            break;
          case 'in':
            segs.push(`${colExpr} = ANY(${nextParam(values, v)})`);
            break;
          case 'notIn':
            segs.push(`NOT (${colExpr} = ANY(${nextParam(values, v)}))`);
            break;
          case 'lt':  segs.push(`${colExpr} < ${nextParam(values, v)}`); break;
          case 'lte': segs.push(`${colExpr} <= ${nextParam(values, v)}`); break;
          case 'gt':  segs.push(`${colExpr} > ${nextParam(values, v)}`); break;
          case 'gte': segs.push(`${colExpr} >= ${nextParam(values, v)}`); break;
          case 'contains':
            segs.push(`${colExpr} ${op.mode === 'insensitive' ? 'ILIKE' : 'LIKE'} ${nextParam(values, `%${v}%`)}`);
            break;
          case 'startsWith':
            segs.push(`${colExpr} ${op.mode === 'insensitive' ? 'ILIKE' : 'LIKE'} ${nextParam(values, `${v}%`)}`);
            break;
          case 'endsWith':
            segs.push(`${colExpr} ${op.mode === 'insensitive' ? 'ILIKE' : 'LIKE'} ${nextParam(values, `%${v}`)}`);
            break;
          case 'mode':
            break;
          default:
            throw new Error(`pg-data-client: unsupported where operator '${k}' on ${ctx.meta.model}.${key}`);
        }
      }
      if (segs.length) parts.push(`(${segs.join(' AND ')})`);
      continue;
    }

    parts.push(`${colExpr} = ${nextParam(values, raw)}`);
  }
  return parts;
}

function compileWhere(
  where: Record<string, unknown> | undefined,
  ctx: CompileCtx,
  values: unknown[],
): string {
  if (!where) return '';
  const parts = compileConditions(where, ctx, values);
  return parts.length === 0 ? '' : parts.join(' AND ');
}

function compileOrderBy(orderBy: unknown, alias: string): string {
  if (!orderBy) return '';
  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  const segs: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      // v may be 'asc'|'desc' or { sort, nulls } per Prisma's API.
      let dir = 'ASC';
      let nulls = '';
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const vo = v as Record<string, unknown>;
        if (String(vo.sort).toLowerCase() === 'desc') dir = 'DESC';
        if (vo.nulls === 'last') nulls = ' NULLS LAST';
        else if (vo.nulls === 'first') nulls = ' NULLS FIRST';
      } else if (String(v).toLowerCase() === 'desc') {
        dir = 'DESC';
      }
      segs.push(`${alias}.${QC(k)} ${dir}${nulls}`);
    }
  }
  return segs.length ? `ORDER BY ${segs.join(', ')}` : '';
}

function compileSelect(
  select: unknown,
  columns: ReadonlySet<string>,
): string[] | null {
  if (!select || typeof select !== 'object') return null;
  const out: string[] = [];
  for (const [k, v] of Object.entries(select as Record<string, unknown>)) {
    if (v === true && columns.has(k)) out.push(k);
  }
  return out;
}

function extractIncludesFromSelect(select: unknown): IncludeSpec | undefined {
  if (!select || typeof select !== 'object') return undefined;
  const out: IncludeSpec = {};
  let any = false;
  for (const [k, v] of Object.entries(select as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = v as IncludeSpec[string];
      any = true;
    }
  }
  return any ? out : undefined;
}

// --- value coercion ----------------------------------------------------------

function toDb(meta: ModelMeta, col: string, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (meta.jsonCols.has(col)) {
    if (typeof raw === 'string') return raw;
    return JSON.stringify(raw);
  }
  if (meta.byteaCols.has(col)) {
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    return raw;
  }
  return raw;
}

function compileInsertCols(
  meta: ModelMeta,
  data: Record<string, unknown>,
): { cols: string[]; values: unknown[] } {
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (!meta.columns.has(k)) continue;
    cols.push(k);
    values.push(toDb(meta, k, v));
  }
  // Prisma `@updatedAt`: fill now() when column exists; some schemas have
  // it NOT NULL without a DB default, so inserts otherwise fail.
  if (meta.columns.has('updatedAt') && !cols.includes('updatedAt')) {
    cols.push('updatedAt');
    values.push(new Date());
  }
  return { cols, values };
}

function compileUpdateSets(
  meta: ModelMeta,
  data: Record<string, unknown>,
  values: unknown[],
): string[] {
  const sets: string[] = [];
  // Prisma `@updatedAt`: bump unless caller is setting it explicitly.
  if (meta.columns.has('updatedAt') && !('updatedAt' in data)) {
    sets.push(`"updatedAt" = ${nextParam(values, new Date())}`);
  }
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (!meta.columns.has(k)) continue;
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date) &&
      !Buffer.isBuffer(v) &&
      ('increment' in v || 'decrement' in v || 'set' in v)
    ) {
      const op = v as Record<string, unknown>;
      if ('increment' in op) {
        sets.push(`${QC(k)} = ${QC(k)} + ${nextParam(values, op.increment)}`);
      } else if ('decrement' in op) {
        sets.push(`${QC(k)} = ${QC(k)} - ${nextParam(values, op.decrement)}`);
      } else if ('set' in op) {
        sets.push(`${QC(k)} = ${nextParam(values, toDb(meta, k, op.set))}`);
      }
      continue;
    }
    sets.push(`${QC(k)} = ${nextParam(values, toDb(meta, k, v))}`);
  }
  return sets;
}

// --- include resolution ------------------------------------------------------

async function loadRelations(
  runner: QueryRunner,
  meta: ModelMeta,
  rows: Record<string, unknown>[],
  includeMerged: IncludeSpec,
): Promise<void> {
  if (rows.length === 0) return;
  for (const [relName, spec] of Object.entries(includeMerged)) {
    if (spec === false || spec === undefined) continue;
    const rel = meta.relations[relName];
    if (!rel) continue;
    const relMeta = MODELS[rel.target]!;
    const subOpts =
      typeof spec === 'object' && spec !== null
        ? (spec as {
            include?: IncludeSpec;
            select?: Record<string, unknown>;
            orderBy?: unknown;
            where?: Record<string, unknown>;
          })
        : {};

    if (rel.kind === 'one') {
      const localKey = rel.localKey ?? meta.id[0]!;
      const foreignKey = rel.foreignKey ?? relMeta.id[0]!;
      const ids = Array.from(
        new Set(rows.map((r) => r[localKey]).filter((v) => v !== null && v !== undefined)),
      );
      if (ids.length === 0) {
        for (const r of rows) r[relName] = null;
        continue;
      }
      const values: unknown[] = [ids];
      let sql = `SELECT * FROM ${QT(relMeta.table)} WHERE ${QC(foreignKey)} = ANY($1)`;
      if (subOpts.where) {
        const ctx: CompileCtx = {
          meta: relMeta,
          alias: QT(relMeta.table),
          joins: [],
          aliasSeq: { n: 0 },
        };
        const w = compileConditions(subOpts.where, ctx, values);
        if (w.length) sql += ` AND ${w.join(' AND ')}`;
      }
      const r = await runner.query(sql, values);
      const indexed = new Map<unknown, Record<string, unknown>>();
      for (const row of r.rows) indexed.set(row[foreignKey], row);
      const subInclude = mergeIncludes(subOpts.include, extractIncludesFromSelect(subOpts.select));
      if (subInclude) await loadRelations(runner, relMeta, r.rows, subInclude);
      const select = compileSelect(subOpts.select, relMeta.columns);
      for (const row of rows) {
        const m = indexed.get(row[localKey]);
        row[relName] = m ? projectRow(m, relMeta, select, subInclude) : null;
      }
    } else {
      const localKey = rel.localKey ?? meta.id[0]!;
      const foreignKey =
        rel.foreignKey ?? `${meta.model.charAt(0).toLowerCase() + meta.model.slice(1)}Id`;
      const ids = Array.from(
        new Set(rows.map((r) => r[localKey]).filter((v) => v !== null && v !== undefined)),
      );
      if (ids.length === 0) {
        for (const r of rows) r[relName] = [];
        continue;
      }
      const values: unknown[] = [ids];
      let sql = `SELECT * FROM ${QT(relMeta.table)} WHERE ${QC(foreignKey)} = ANY($1)`;
      if (subOpts.where) {
        const ctx: CompileCtx = {
          meta: relMeta,
          alias: QT(relMeta.table),
          joins: [],
          aliasSeq: { n: 0 },
        };
        const w = compileConditions(subOpts.where, ctx, values);
        if (w.length) sql += ` AND ${w.join(' AND ')}`;
      }
      sql += ' ' + compileOrderBy(subOpts.orderBy, QT(relMeta.table));
      const r = await runner.query(sql, values);
      const subInclude = mergeIncludes(subOpts.include, extractIncludesFromSelect(subOpts.select));
      if (subInclude) await loadRelations(runner, relMeta, r.rows, subInclude);
      const select = compileSelect(subOpts.select, relMeta.columns);
      const grouped = new Map<unknown, Record<string, unknown>[]>();
      for (const row of r.rows) {
        const k = row[foreignKey];
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k)!.push(projectRow(row, relMeta, select, subInclude));
      }
      const take = (subOpts as { take?: number }).take;
      const skip = (subOpts as { skip?: number }).skip ?? 0;
      for (const row of rows) {
        let arr = grouped.get(row[localKey]) ?? [];
        if (skip > 0) arr = arr.slice(skip);
        if (typeof take === 'number') arr = arr.slice(0, take);
        row[relName] = arr;
      }
    }
  }
}

function mergeIncludes(a?: IncludeSpec, b?: IncludeSpec): IncludeSpec | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) };
}

function projectRow(
  row: Record<string, unknown>,
  meta: ModelMeta,
  select: string[] | null,
  include: IncludeSpec | undefined,
): Record<string, unknown> {
  if (!select && !include) return row;
  const out: Record<string, unknown> = {};
  if (select) {
    for (const c of select) out[c] = row[c];
  } else {
    for (const c of meta.columns) out[c] = row[c];
  }
  if (include) {
    for (const k of Object.keys(include)) if (k in row) out[k] = row[k];
  }
  return out;
}

// --- core ops ----------------------------------------------------------------

interface FindOpts {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  include?: IncludeSpec;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  distinct?: string | string[];
}

async function findManyImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  opts: FindOpts,
): Promise<Record<string, unknown>[]> {
  const values: unknown[] = [];
  const alias = QT(meta.table);
  const ctx: CompileCtx = { meta, alias, joins: [], aliasSeq: { n: 0 } };
  const where = compileWhere(opts.where, ctx, values);
  const orderBy = compileOrderBy(opts.orderBy, alias);
  const limit = opts.take ? `LIMIT ${Number(opts.take)}` : '';
  const offset = opts.skip ? `OFFSET ${Number(opts.skip)}` : '';
  const distinct = opts.distinct
    ? `DISTINCT ON (${(Array.isArray(opts.distinct) ? opts.distinct : [opts.distinct])
        .map((c) => `${alias}.${QC(c)}`)
        .join(', ')})`
    : '';
  const select = compileSelect(opts.select, meta.columns);
  const subInclude = mergeIncludes(opts.include, extractIncludesFromSelect(opts.select));

  // When `select` references only relations, still include PK and any
  // local-key columns referenced by an include so the relation loader can bind.
  const effectiveScalarCols = (() => {
    if (!select) return null;
    const required = new Set<string>(select);
    for (const idCol of meta.id) required.add(idCol);
    if (subInclude) {
      for (const relName of Object.keys(subInclude)) {
        const rel = meta.relations[relName];
        if (rel?.localKey && meta.columns.has(rel.localKey)) required.add(rel.localKey);
      }
    }
    return Array.from(required);
  })();

  const cols = effectiveScalarCols
    ? effectiveScalarCols.map((c) => `${alias}.${QC(c)}`).join(', ')
    : `${alias}.*`;
  const sql = `SELECT ${distinct} ${cols} FROM ${QT(meta.table)} ${alias} ${
    where ? 'WHERE ' + where : ''
  } ${orderBy} ${limit} ${offset}`
    .replace(/\s+/g, ' ')
    .trim();
  const r = await runner.query(sql, values);
  if (subInclude) await loadRelations(runner, meta, r.rows, subInclude);
  return r.rows.map((row) => projectRow(row, meta, select, subInclude));
}

async function findFirstImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  opts: FindOpts,
): Promise<Record<string, unknown> | null> {
  const rows = await findManyImpl(runner, meta, { ...opts, take: 1 });
  return rows[0] ?? null;
}

async function findFirstOrThrowImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  opts: FindOpts,
): Promise<Record<string, unknown>> {
  const r = await findFirstImpl(runner, meta, opts);
  if (!r) throw new Error(`No ${meta.model} found`);
  return r;
}

async function createImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  data: Record<string, unknown>,
  include?: IncludeSpec,
  select?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { cols, values } = compileInsertCols(meta, data);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${QT(meta.table)} (${cols.map(QC).join(', ')}) VALUES (${placeholders}) RETURNING *`;
  const r = await runner.query(sql, values);
  const row = r.rows[0]!;
  const subInclude = mergeIncludes(include, extractIncludesFromSelect(select));
  if (subInclude) await loadRelations(runner, meta, [row], subInclude);
  const sel = compileSelect(select, meta.columns);
  return projectRow(row, meta, sel, subInclude);
}

async function updateImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
  include?: IncludeSpec,
  select?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const values: unknown[] = [];
  const sets = compileUpdateSets(meta, data, values);
  if (sets.length === 0) {
    return findFirstOrThrowImpl(runner, meta, { where, include, select });
  }
  const ctx: CompileCtx = { meta, alias: QT(meta.table), joins: [], aliasSeq: { n: 0 } };
  const whereSql = compileWhere(where, ctx, values);
  const sql = `UPDATE ${QT(meta.table)} SET ${sets.join(', ')} ${
    whereSql ? 'WHERE ' + whereSql : ''
  } RETURNING *`;
  const r = await runner.query(sql, values);
  if (r.rowCount === 0) throw new Error(`update: no row matched in ${meta.model}`);
  const row = r.rows[0]!;
  const subInclude = mergeIncludes(include, extractIncludesFromSelect(select));
  if (subInclude) await loadRelations(runner, meta, [row], subInclude);
  const sel = compileSelect(select, meta.columns);
  return projectRow(row, meta, sel, subInclude);
}

async function updateManyImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  where: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): Promise<{ count: number }> {
  const values: unknown[] = [];
  const sets = compileUpdateSets(meta, data, values);
  if (sets.length === 0) return { count: 0 };
  const ctx: CompileCtx = { meta, alias: QT(meta.table), joins: [], aliasSeq: { n: 0 } };
  const whereSql = compileWhere(where, ctx, values);
  const sql = `UPDATE ${QT(meta.table)} SET ${sets.join(', ')} ${
    whereSql ? 'WHERE ' + whereSql : ''
  }`;
  const r = await runner.query(sql, values);
  return { count: r.rowCount ?? 0 };
}

async function deleteImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  where: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const values: unknown[] = [];
  const ctx: CompileCtx = { meta, alias: QT(meta.table), joins: [], aliasSeq: { n: 0 } };
  const whereSql = compileWhere(where, ctx, values);
  const sql = `DELETE FROM ${QT(meta.table)} ${whereSql ? 'WHERE ' + whereSql : ''} RETURNING *`;
  const r = await runner.query(sql, values);
  if (r.rowCount === 0) throw new Error(`delete: no row matched in ${meta.model}`);
  return r.rows[0]!;
}

async function deleteManyImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  where: Record<string, unknown> | undefined,
): Promise<{ count: number }> {
  const values: unknown[] = [];
  const ctx: CompileCtx = { meta, alias: QT(meta.table), joins: [], aliasSeq: { n: 0 } };
  const whereSql = compileWhere(where, ctx, values);
  const sql = `DELETE FROM ${QT(meta.table)} ${whereSql ? 'WHERE ' + whereSql : ''}`;
  const r = await runner.query(sql, values);
  return { count: r.rowCount ?? 0 };
}

async function countImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  opts: { where?: Record<string, unknown> },
): Promise<number> {
  const values: unknown[] = [];
  const ctx: CompileCtx = { meta, alias: QT(meta.table), joins: [], aliasSeq: { n: 0 } };
  const whereSql = compileWhere(opts.where, ctx, values);
  const sql = `SELECT COUNT(*)::int AS c FROM ${QT(meta.table)} ${
    whereSql ? 'WHERE ' + whereSql : ''
  }`;
  const r = await runner.query<{ c: number }>(sql, values);
  return r.rows[0]?.c ?? 0;
}

async function aggregateImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  opts: {
    where?: Record<string, unknown>;
    _max?: Record<string, true>;
    _min?: Record<string, true>;
    _sum?: Record<string, true>;
    _count?: Record<string, true> | true;
  },
): Promise<{
  _max?: Record<string, unknown>;
  _min?: Record<string, unknown>;
  _sum?: Record<string, unknown>;
  _count?: number | Record<string, number>;
}> {
  const values: unknown[] = [];
  const ctx: CompileCtx = { meta, alias: QT(meta.table), joins: [], aliasSeq: { n: 0 } };
  const whereSql = compileWhere(opts.where, ctx, values);
  const exprs: string[] = [];
  const maxKeys = opts._max ? Object.keys(opts._max) : [];
  const minKeys = opts._min ? Object.keys(opts._min) : [];
  const sumKeys = opts._sum ? Object.keys(opts._sum) : [];
  for (const k of maxKeys) exprs.push(`MAX("${k}") AS "max_${k}"`);
  for (const k of minKeys) exprs.push(`MIN("${k}") AS "min_${k}"`);
  for (const k of sumKeys) exprs.push(`SUM("${k}") AS "sum_${k}"`);
  if (opts._count) exprs.push('COUNT(*)::int AS "count_all"');
  if (exprs.length === 0) exprs.push('COUNT(*)::int AS "count_all"');
  const sql = `SELECT ${exprs.join(', ')} FROM ${QT(meta.table)} ${
    whereSql ? 'WHERE ' + whereSql : ''
  }`;
  const r = await runner.query<Record<string, unknown>>(sql, values);
  const row = r.rows[0] ?? {};
  const out: {
    _max?: Record<string, unknown>;
    _min?: Record<string, unknown>;
    _sum?: Record<string, unknown>;
    _count?: number | Record<string, number>;
  } = {};
  if (maxKeys.length) {
    out._max = {};
    for (const k of maxKeys) out._max[k] = row[`max_${k}`] ?? null;
  }
  if (minKeys.length) {
    out._min = {};
    for (const k of minKeys) out._min[k] = row[`min_${k}`] ?? null;
  }
  if (sumKeys.length) {
    out._sum = {};
    for (const k of sumKeys) out._sum[k] = row[`sum_${k}`] ?? null;
  }
  if (opts._count) out._count = row.count_all as number;
  return out;
}

async function groupByImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  opts: {
    by: string[];
    where?: Record<string, unknown>;
    _count?: Record<string, true> | true;
    orderBy?: unknown;
  },
): Promise<Record<string, unknown>[]> {
  const values: unknown[] = [];
  const ctx: CompileCtx = { meta, alias: QT(meta.table), joins: [], aliasSeq: { n: 0 } };
  const whereSql = compileWhere(opts.where, ctx, values);
  const groupCols = opts.by.map(QC).join(', ');
  const projections = opts.by.map((c) => `"${c}"`);
  if (opts._count) projections.push('COUNT(*)::int AS "_count_all"');
  const sql = `SELECT ${projections.join(', ')} FROM ${QT(meta.table)} ${
    whereSql ? 'WHERE ' + whereSql : ''
  } GROUP BY ${groupCols} ${compileOrderBy(opts.orderBy, QT(meta.table))}`;
  const r = await runner.query(sql, values);
  return r.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of opts.by) out[c] = row[c];
    if (opts._count) out._count = { _all: (row as Record<string, unknown>)._count_all };
    return out;
  });
}

async function upsertImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    include?: IncludeSpec;
    select?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const existing = await findFirstImpl(runner, meta, { where: args.where });
  if (existing) {
    return updateImpl(runner, meta, args.where, args.update, args.include, args.select);
  }
  return createImpl(runner, meta, args.create, args.include, args.select);
}

// --- model proxy + transaction proxy ----------------------------------------

async function createManyImpl(
  runner: QueryRunner,
  meta: ModelMeta,
  data: Record<string, unknown>[],
  skipDuplicates: boolean,
): Promise<{ count: number }> {
  if (data.length === 0) return { count: 0 };
  const cols = Array.from(
    new Set(data.flatMap((row) => Object.keys(row).filter((k) => meta.columns.has(k)))),
  );
  // Match createImpl: fill `updatedAt` when column exists. Some tables are
  // NOT NULL with no DB default, so a bulk insert without it fails.
  if (meta.columns.has('updatedAt') && !cols.includes('updatedAt')) {
    cols.push('updatedAt');
  }
  if (cols.length === 0) return { count: 0 };
  const values: unknown[] = [];
  const tuples: string[] = [];
  const now = new Date();
  for (const row of data) {
    const placeholders: string[] = [];
    for (const c of cols) {
      let v: unknown = row[c];
      if (v === undefined && c === 'updatedAt' && meta.columns.has('updatedAt')) {
        v = now;
      }
      if (v === undefined) {
        placeholders.push('DEFAULT');
      } else {
        placeholders.push(nextParam(values, toDb(meta, c, v)));
      }
    }
    tuples.push(`(${placeholders.join(', ')})`);
  }
  const onConflict = skipDuplicates
    ? `ON CONFLICT (${meta.id.map(QC).join(', ')}) DO NOTHING`
    : '';
  const sql = `INSERT INTO ${QT(meta.table)} (${cols.map(QC).join(', ')}) VALUES ${tuples.join(', ')} ${onConflict}`;
  const r = await runner.query(sql, values);
  return { count: r.rowCount ?? 0 };
}

function buildModelProxy(meta: ModelMeta, runner: QueryRunner): ModelProxy {
  return {
    findMany: (opts: FindOpts = {}) => findManyImpl(runner, meta, opts) as Promise<any>,
    findFirst: (opts: FindOpts = {}) => findFirstImpl(runner, meta, opts) as Promise<any>,
    findFirstOrThrow: (opts: FindOpts = {}) =>
      findFirstOrThrowImpl(runner, meta, opts) as Promise<any>,
    findUnique: (args) => findFirstImpl(runner, meta, args) as Promise<any>,
    findUniqueOrThrow: (args) => findFirstOrThrowImpl(runner, meta, args) as Promise<any>,
    create: (args) =>
      createImpl(runner, meta, args.data, args.include, args.select) as Promise<any>,
    update: (args) =>
      updateImpl(runner, meta, args.where, args.data, args.include, args.select) as Promise<any>,
    updateMany: (args) => updateManyImpl(runner, meta, args.where, args.data),
    delete: (args) => deleteImpl(runner, meta, args.where) as Promise<any>,
    deleteMany: (args = {}) => deleteManyImpl(runner, meta, args.where),
    count: (args = {}) => countImpl(runner, meta, args),
    aggregate: (args) => aggregateImpl(runner, meta, args) as Promise<any>,
    groupBy: (args) => groupByImpl(runner, meta, args) as Promise<any>,
    upsert: (args) => upsertImpl(runner, meta, args) as Promise<any>,
    createMany: (args) =>
      createManyImpl(runner, meta, args.data, args.skipDuplicates ?? false),
  };
}

/**
 * Each method returns `any` so existing callers (which already consume
 * Prisma's specific row types ducktype-style and frequently `as any` for
 * JSON columns) keep compiling without per-site changes. The runtime
 * data shapes are still validated by the underlying SQL — only the
 * compile-time strictness is relaxed at this boundary.
 */
export interface ModelProxy {
  findMany(opts?: FindOpts): Promise<any[]>;
  findFirst(opts?: FindOpts): Promise<any | null>;
  findFirstOrThrow(opts?: FindOpts): Promise<any>;
  findUnique(args: { where: Record<string, unknown>; include?: IncludeSpec; select?: Record<string, unknown> }): Promise<any | null>;
  findUniqueOrThrow(args: { where: Record<string, unknown>; include?: IncludeSpec; select?: Record<string, unknown> }): Promise<any>;
  create(args: { data: Record<string, unknown>; include?: IncludeSpec; select?: Record<string, unknown> }): Promise<any>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown>; include?: IncludeSpec; select?: Record<string, unknown> }): Promise<any>;
  updateMany(args: { where?: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  delete(args: { where: Record<string, unknown> }): Promise<any>;
  deleteMany(args?: { where?: Record<string, unknown> }): Promise<{ count: number }>;
  count(args?: { where?: Record<string, unknown> }): Promise<number>;
  aggregate(args: { where?: Record<string, unknown>; _max?: Record<string, true>; _min?: Record<string, true>; _sum?: Record<string, true>; _count?: Record<string, true> | true }): Promise<any>;
  groupBy(args: { by: string[]; where?: Record<string, unknown>; _count?: Record<string, true> | true; orderBy?: unknown }): Promise<any[]>;
  upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown>; include?: IncludeSpec; select?: Record<string, unknown> }): Promise<any>;
  /** Bulk insert. `skipDuplicates` translates to ON CONFLICT DO NOTHING on the model's PK. */
  createMany(args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
}

export interface PgDataClient {
  identifierCounter: ModelProxy;
  tenant: ModelProxy;
  user: ModelProxy;
  process: ModelProxy;
  managerDirectory: ModelProxy;
  systemFunction: ModelProxy;
  processFunction: ModelProxy;
  functionAuditRequest: ModelProxy;
  processMember: ModelProxy;
  processMemberScopePermission: ModelProxy;
  workbookFile: ModelProxy;
  fileBlob: ModelProxy;
  fileVersion: ModelProxy;
  fileDraft: ModelProxy;
  workbookSheet: ModelProxy;
  auditRule: ModelProxy;
  aiPilotRuleMeta: ModelProxy;
  aiPilotSandboxSession: ModelProxy;
  aiPilotAuditLog: ModelProxy;
  auditRun: ModelProxy;
  savedVersion: ModelProxy;
  auditIssue: ModelProxy;
  issueComment: ModelProxy;
  issueCorrection: ModelProxy;
  issueAcknowledgment: ModelProxy;
  trackingEntry: ModelProxy;
  trackingStageComment: ModelProxy;
  trackingAttachment: ModelProxy;
  trackingEvent: ModelProxy;
  composerNotificationTemplate: ModelProxy;
  notificationTemplate: ModelProxy;
  notification: ModelProxy;
  activityLog: ModelProxy;
  export: ModelProxy;
  job: ModelProxy;
  userPreference: ModelProxy;
  apiToken: ModelProxy;
  webhookEndpoint: ModelProxy;
  liveSession: ModelProxy;
  signedLink: ModelProxy;
  notificationLog: ModelProxy;
  $transaction<T>(fn: (tx: PgDataClient) => Promise<T>): Promise<T>;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  /**
   * Tagged-template raw query. Mirrors Prisma's signature: `T` is the
   * **whole result type** (e.g. `Array<{...}>`) — not the row type.
   */
  $queryRaw<T = unknown[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  /** Tagged-template raw execute. Returns affected rowCount. */
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

function uncap(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

function attachModelProxies(
  target: Record<string, unknown>,
  runner: QueryRunner,
): void {
  for (const [, meta] of Object.entries(MODELS)) {
    target[uncap(meta.model)] = buildModelProxy(meta, runner);
  }
}

function compileTaggedTemplate(
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; params: unknown[] } {
  let text = '';
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i];
    if (i < values.length) text += `$${i + 1}`;
  }
  return { text, params: values };
}

function attachRawHelpers(target: Record<string, unknown>, runner: QueryRunner): void {
  target.$queryRaw = async <T = unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> => {
    const { text, params } = compileTaggedTemplate(strings, values);
    const r = await runner.query<Record<string, unknown>>(text, params);
    return r.rows as unknown as T;
  };
  target.$executeRaw = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number> => {
    const { text, params } = compileTaggedTemplate(strings, values);
    const r = await runner.query(text, params);
    return r.rowCount ?? 0;
  };
}

export function buildPgDataClient(pool: Pool): PgDataClient {
  const poolRunner: QueryRunner = {
    query: <T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) => pool.query<T>(text, values ?? []) as Promise<QueryResult<T>>,
  };
  const client = {} as Record<string, unknown>;
  attachModelProxies(client, poolRunner);
  attachRawHelpers(client, poolRunner);
  client.$transaction = async <T>(fn: (tx: PgDataClient) => Promise<T>): Promise<T> => {
    const conn: PoolClient = await pool.connect();
    try {
      await conn.query('BEGIN');
      const txRunner: QueryRunner = {
        query: <U extends Record<string, unknown> = Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ) => conn.query<U>(text, values ?? []) as Promise<QueryResult<U>>,
      };
      const tx = {} as Record<string, unknown>;
      attachModelProxies(tx, txRunner);
      attachRawHelpers(tx, txRunner);
      tx.$transaction = client.$transaction;
      tx.$connect = async () => {};
      tx.$disconnect = async () => {};
      const result = await fn(tx as unknown as PgDataClient);
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };
  client.$connect = async () => {};
  client.$disconnect = async () => {};
  return client as unknown as PgDataClient;
}
