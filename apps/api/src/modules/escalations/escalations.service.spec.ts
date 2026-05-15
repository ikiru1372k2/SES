import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SessionUser } from '@ses/domain';
import { EscalationsService } from './escalations.service';

type AnyObj = Record<string, unknown>;

function buildService(opts: {
  issues: Array<{ issueKey: string; projectManager: string; email: string | null; projectNo: string | null; projectName: string | null }>;
  tracking: Array<AnyObj>;
  directory: Array<{ normalizedKey: string; email: string }>;
}) {
  const prisma = {
    auditRun: {
      // Emit a single completed run for the master-data engine; the other
      // engines short-circuit to null. That's enough to exercise the
      // aggregator-plus-enrichment path end-to-end.
      findFirst: (args: AnyObj) => {
        const where = (args.where as AnyObj) ?? {};
        const file = (where.file as AnyObj) ?? {};
        if (file.functionId !== 'master-data') return Promise.resolve(null);
        return Promise.resolve({
          issues: opts.issues,
        });
      },
    },
    trackingEntry: {
      findMany: () => Promise.resolve(opts.tracking),
    },
    trackingEvent: {
      findMany: () => Promise.resolve([]),
    },
    notificationLog: {
      findMany: () => Promise.resolve([]),
    },
    managerDirectory: {
      findMany: () => Promise.resolve(opts.directory),
    },
  };
  const access = {
    findAccessibleProcessOrThrow: async () => ({ id: 'proc-1', tenantId: 't1' }),
  };
  return new EscalationsService(prisma as never, access as never);
}

const user: SessionUser = {
  id: 'u1',
  displayCode: 'USR-1',
  email: 'me@example.com',
  displayName: 'Me',
  role: 'auditor',
} as SessionUser;

describe('EscalationsService directory enrichment', () => {
  it('clears isUnmapped when directory resolves the manager after aggregation', async () => {
    const svc = buildService({
      issues: [
        {
          issueKey: 'k1',
          projectManager: 'Bob Example',
          email: null,
          projectNo: 'P1',
          projectName: 'N1',
        },
      ],
      tracking: [
        {
          id: 't1',
          displayCode: 'TRK-1',
          managerKey: 'missing-email:bob-example',
          managerName: 'Bob Example',
          managerEmail: null,
          stage: 'OPEN',
          escalationLevel: 0,
          resolved: false,
          lastContactAt: null,
          slaDueAt: null,
          verifiedAt: null,
          verifiedBy: null,
          outlookCount: 0,
          teamsCount: 0,
          draftLockExpiresAt: null,
          draftLockUser: null,
        },
      ],
      directory: [{ normalizedKey: 'bob example', email: 'bob@example.com' }],
    });

    const payload = await svc.getForProcess('proc-1', user);

    assert.equal(payload.rows.length, 1);
    const row = payload.rows[0]!;
    assert.equal(row.directoryEmail, 'bob@example.com');
    // The aggregator flagged this row unmapped because the tracking/issue
    // carried no email and the key was missing-email:*. After directory
    // enrichment the service treats the directoryEmail as the effective
    // email and drops the flag.
    assert.equal(row.isUnmapped, false);
    assert.equal(payload.summary.unmappedManagerCount, 0);
  });

  it('keeps rows truly unmapped when no directory entry matches', async () => {
    const svc = buildService({
      issues: [
        {
          issueKey: 'k1',
          projectManager: 'Alice Ghost',
          email: null,
          projectNo: 'P1',
          projectName: 'N1',
        },
      ],
      tracking: [],
      directory: [{ normalizedKey: 'bob example', email: 'bob@example.com' }],
    });

    const payload = await svc.getForProcess('proc-1', user);

    assert.equal(payload.rows.length, 1);
    const row = payload.rows[0]!;
    assert.equal(row.directoryEmail, null);
    assert.equal(row.isUnmapped, true);
    assert.equal(payload.summary.unmappedManagerCount, 1);
  });

  it('handles mixed rows: one tracking-mapped, one directory-mapped, one unmapped', async () => {
    const svc = buildService({
      issues: [
        {
          issueKey: 'k1',
          projectManager: 'Alice',
          email: 'alice@example.com',
          projectNo: 'P1',
          projectName: 'N1',
        },
        {
          issueKey: 'k2',
          projectManager: 'Bob Example',
          email: null,
          projectNo: 'P2',
          projectName: 'N2',
        },
        {
          issueKey: 'k3',
          projectManager: 'Ghost',
          email: null,
          projectNo: 'P3',
          projectName: 'N3',
        },
      ],
      tracking: [],
      directory: [{ normalizedKey: 'bob example', email: 'bob@example.com' }],
    });

    const payload = await svc.getForProcess('proc-1', user);

    const byName = new Map(payload.rows.map((r) => [r.managerName, r]));
    assert.equal(byName.get('Alice')!.isUnmapped, false);
    assert.equal(byName.get('Bob Example')!.isUnmapped, false);
    assert.equal(byName.get('Bob Example')!.directoryEmail, 'bob@example.com');
    assert.equal(byName.get('Ghost')!.isUnmapped, true);
    assert.equal(payload.summary.unmappedManagerCount, 1);
  });
});
