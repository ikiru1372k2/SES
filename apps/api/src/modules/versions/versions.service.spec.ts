import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SessionUser } from '@ses/domain';
import { VersionsService } from './versions.service';

type Row = {
  id: string;
  processId: string;
  functionId: string;
  versionNumber: number;
  auditRunId: string;
};

/**
 * In-memory SavedVersion store whose aggregate()/create() mirror the pg
 * client semantics the service relies on, so we can assert the per-function
 * counter without a database.
 */
function buildService(runs: Record<string, { id: string; processId: string; functionId: string }>) {
  const saved: Row[] = [];
  let seq = 0;

  const tx = {
    auditRun: {
      findFirst: async ({ where }: { where: { OR?: Array<{ id?: string; displayCode?: string }>; status?: string } }) => {
        const code = where.OR?.[0]?.id ?? where.OR?.[1]?.displayCode;
        const run = code ? runs[code] : Object.values(runs)[0];
        if (!run) return null;
        return { id: run.id, displayCode: run.id, file: { functionId: run.functionId } };
      },
    },
    savedVersion: {
      aggregate: async ({ where }: { where: { processId: string; functionId: string } }) => {
        const scoped = saved.filter(
          (r) => r.processId === where.processId && r.functionId === where.functionId,
        );
        const max = scoped.reduce((m, r) => Math.max(m, r.versionNumber), 0);
        return { _max: { versionNumber: scoped.length ? max : null } };
      },
      create: async ({ data }: { data: Row & { displayCode: string } }) => {
        // Enforce the new per-(process,function,versionNumber) uniqueness.
        const clash = saved.some(
          (r) =>
            r.processId === data.processId &&
            r.functionId === data.functionId &&
            r.versionNumber === data.versionNumber,
        );
        if (clash) throw new Error('unique violation processId_functionId_versionNumber');
        const row: Row = {
          id: data.id,
          processId: data.processId,
          functionId: data.functionId,
          versionNumber: data.versionNumber,
          auditRunId: data.auditRunId,
        };
        saved.push(row);
        return {
          ...row,
          displayCode: data.displayCode,
          versionName: 'n',
          notes: '',
          createdAt: new Date(),
          auditRun: {
            id: data.auditRunId,
            displayCode: data.auditRunId,
            requestId: 'r',
            fileId: 'f',
            scannedRows: 0,
            flaggedRows: 0,
            startedAt: new Date(),
            completedAt: new Date(),
            policySnapshot: {},
            summary: {},
            issues: [],
          },
        };
      },
    },
  };

  const prisma = {
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const identifiers = { nextVersionCode: async () => `VER-${++seq}` };
  const activity = { append: async () => undefined };
  const processAccess = {
    findAccessibleProcessOrThrow: async () => ({ id: 'proc-1', displayCode: 'PRC-1' }),
  };
  const realtime = { emitToProcess: () => undefined };
  const chatCache = { evictMatching: () => 0 };

  const svc = new VersionsService(
    prisma as never,
    identifiers as never,
    activity as never,
    processAccess as never,
    realtime as never,
    chatCache as never,
  );
  return { svc, saved };
}

const user = { id: 'u1', displayCode: 'USR-1', email: 'a@b.c', displayName: 'A' } as SessionUser;

describe('VersionsService per-function versioning', () => {
  it('numbers each function independently and never cross-bumps', async () => {
    const { svc } = buildService({
      'run-md-1': { id: 'run-md-1', processId: 'proc-1', functionId: 'master-data' },
      'run-op-1': { id: 'run-op-1', processId: 'proc-1', functionId: 'over-planning' },
      'run-md-2': { id: 'run-md-2', processId: 'proc-1', functionId: 'master-data' },
      'run-op-2': { id: 'run-op-2', processId: 'proc-1', functionId: 'over-planning' },
    });

    // master-data v1
    const a1 = await svc.create('PRC-1', { auditRunIdOrCode: 'run-md-1', versionName: 'A1' }, user);
    assert.equal(a1.functionId, 'master-data');
    assert.equal(a1.versionNumber, 1);

    // over-planning v1 — independent lifecycle, NOT v2
    const b1 = await svc.create('PRC-1', { auditRunIdOrCode: 'run-op-1', versionName: 'B1' }, user);
    assert.equal(b1.functionId, 'over-planning');
    assert.equal(b1.versionNumber, 1, 'function B starts its own sequence at 1');

    // master-data again → v2; over-planning untouched
    const a2 = await svc.create('PRC-1', { auditRunIdOrCode: 'run-md-2', versionName: 'A2' }, user);
    assert.equal(a2.versionNumber, 2, 'only function A advanced');

    // over-planning again → v2 (not v3/v4 from A's saves)
    const b2 = await svc.create('PRC-1', { auditRunIdOrCode: 'run-op-2', versionName: 'B2' }, user);
    assert.equal(b2.versionNumber, 2, 'function B advanced on its own track');
  });

  it('falls back to master-data when the run file has no functionId', async () => {
    const { svc } = buildService({
      'run-x': { id: 'run-x', processId: 'proc-1', functionId: undefined as unknown as string },
    });
    const v = await svc.create('PRC-1', { auditRunIdOrCode: 'run-x', versionName: 'X' }, user);
    assert.equal(v.functionId, 'master-data');
    assert.equal(v.versionNumber, 1);
  });
});
