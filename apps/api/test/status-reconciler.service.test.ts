import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { StatusReconcilerService } from '../src/status-reconciler.service';
import type { IdentifierService } from '../src/common/identifier.service';

// Minimal identifier stub — the tests never observe new-manager creation
// (every mocked audit/tracking pair has the manager already), so
// nextTrackingCode should never be called. If it is, return a sentinel
// that would be obvious in any assertion.
const mockIdentifiers = {
  nextTrackingCode: async () => 'TRK-TEST-0001',
} as unknown as IdentifierService;

describe('StatusReconcilerService', () => {
  it('updates only the audited engine slice and aggregate resolved', async () => {
    const updates: Array<{ id: string; data: { projectStatuses: unknown; resolved: boolean } }> = [];
    const mockTx = {
      auditIssue: {
        findMany: async () => [
          { projectManager: 'Bob', email: null },
          { projectManager: 'Bob', email: null },
        ],
      },
      trackingEntry: {
        findMany: async () => [
          {
            id: 'e1',
            managerKey: 'missing-email:bob',
            projectStatuses: {
              byEngine: {
                'master-data': { openCount: 0, status: 'na', lastSeenRunId: null },
                'over-planning': { openCount: 3, status: 'open', lastSeenRunId: 'old' },
              },
              aggregate: { totalOpen: 3, overallStatus: 'open' },
            },
          },
        ],
        update: async ({ where, data }: { where: { id: string }; data: { projectStatuses: unknown; resolved: boolean } }) => {
          updates.push({ id: where.id, data: { projectStatuses: data.projectStatuses, resolved: data.resolved } });
          return { id: where.id };
        },
      },
    };

    const svc = new StatusReconcilerService(mockIdentifiers);
    await svc.reconcileAfterAudit(mockTx as never, {
      processId: 'p1',
      functionId: 'master-data',
      auditRunId: 'run-new',
    });

    assert.equal(updates.length, 1);
    const u0 = updates[0];
    assert.ok(u0);
    const ps = u0.data.projectStatuses as {
      byEngine: Record<string, { openCount: number; status: string }>;
    };
    assert.equal(ps.byEngine['master-data']!.openCount, 2);
    assert.equal(ps.byEngine['master-data']!.status, 'open');
    assert.equal(ps.byEngine['over-planning']!.openCount, 3);
    assert.equal(updates[0]!.data.resolved, false);
  });

  it('marks engine resolved when no issues for manager', async () => {
    const updates: Array<{ resolved: boolean }> = [];
    const mockTx = {
      auditIssue: {
        findMany: async () => [],
      },
      trackingEntry: {
        findMany: async () => [
          {
            id: 'e1',
            managerKey: 'missing-email:bob',
            projectStatuses: {
              byEngine: {
                'master-data': { openCount: 2, status: 'open', lastSeenRunId: 'r0' },
                'over-planning': { openCount: 0, status: 'resolved', lastSeenRunId: 'r0', resolvedAt: '2026-01-01T00:00:00Z' },
              },
              aggregate: { totalOpen: 2, overallStatus: 'mixed' },
            },
          },
        ],
        update: async ({ data }: { data: { resolved: boolean } }) => {
          updates.push({ resolved: data.resolved });
          return {};
        },
      },
    };
    const svc = new StatusReconcilerService(mockIdentifiers);
    await svc.reconcileAfterAudit(mockTx as never, {
      processId: 'p1',
      functionId: 'master-data',
      auditRunId: 'run-2',
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0]!.resolved, true);
  });
});
