import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { managerKey, normalizeObservedManagerLabel } from '@ses/domain';
import { EscalationLevelService } from './escalation-level.service';

type Issue = { issueKey: string | null; projectManager: string | null; email: string | null };
type Run = { findingsHash: string; issues: Issue[] };

function buildService(runs: Run[], directory: Array<{ normalizedKey: string; email: string }> = []) {
  const prisma = {
    auditRun: {
      findMany: () => Promise.resolve(runs),
    },
    managerDirectory: {
      findMany: () => Promise.resolve(directory),
    },
  };
  return new EscalationLevelService(prisma as never);
}

const TENANT = 't1';

const A = { name: 'Manager A', email: 'a@example.com' };
const B = { name: 'Manager B', email: 'b@example.com' };
const X = 'IKY-XAAAAA';
const Y = 'IKY-YBBBBB';

describe('EscalationLevelService', () => {
  it('week1 then week2 with same manager+issue → L2; new manager → L1', async () => {
    const svc = buildService([
      { findingsHash: 'w1', issues: [{ issueKey: X, projectManager: A.name, email: A.email }] },
      {
        findingsHash: 'w2',
        issues: [
          { issueKey: X, projectManager: A.name, email: A.email },
          { issueKey: Y, projectManager: B.name, email: B.email },
        ],
      },
    ]);

    const r = await svc.resolverForProcess('proc-1', TENANT);
    assert.equal(r.levelFor(managerKey(A.name, A.email), X), 2, 'A repeated → L2');
    assert.equal(r.levelFor(managerKey(B.name, B.email), Y), 1, 'B is new → L1');
    assert.equal(r.labelFor(managerKey(A.name, A.email), X), 'L2');
  });

  it('identical re-upload (same findingsHash) does not double-increment', async () => {
    const run = (h: string): Run => ({
      findingsHash: h,
      issues: [{ issueKey: X, projectManager: A.name, email: A.email }],
    });
    const svc = buildService([run('w1'), run('w2'), run('w2'), run('w2')]);
    const r = await svc.resolverForProcess('proc-1', TENANT);
    assert.equal(r.levelFor(managerKey(A.name, A.email), X), 2);
  });

  it('first upload ever → L1', async () => {
    const svc = buildService([
      { findingsHash: 'w1', issues: [{ issueKey: X, projectManager: A.name, email: A.email }] },
    ]);
    const r = await svc.resolverForProcess('proc-1', TENANT);
    assert.equal(r.levelFor(managerKey(A.name, A.email), X), 1);
  });

  it('missing manager and missing issueKey fall back to L1 safely', async () => {
    const svc = buildService([
      {
        findingsHash: 'w1',
        issues: [
          { issueKey: null, projectManager: A.name, email: A.email }, // no issueKey → skipped
          { issueKey: X, projectManager: '', email: null }, // unknown manager bucket
          { issueKey: X, projectManager: '   ', email: null }, // same unknown bucket, week 1
        ],
      },
      {
        findingsHash: 'w2',
        issues: [{ issueKey: X, projectManager: null, email: null }],
      },
    ]);
    const r = await svc.resolverForProcess('proc-1', TENANT);
    // Unknown-manager bucket still levels across distinct uploads.
    assert.equal(r.levelFor(managerKey('Unknown', null), X), 2);
    // A genuinely unseen pair is L1.
    assert.equal(r.levelFor(managerKey(A.name, A.email), X), 1);
  });

  it('non-master-data: email resolved only on the later run still levels to L2 via directory', async () => {
    // Mapping-based functions (over-planning / function-rate / ICR) often
    // carry no email on early runs and an email on later ones. Without the
    // directory the identity would drift (missing-email:* → email) and the
    // repeat would never match — the bug this fixes.
    const svc = buildService(
      [
        { findingsHash: 'w1', issues: [{ issueKey: X, projectManager: 'Manager A', email: null }] },
        { findingsHash: 'w2', issues: [{ issueKey: X, projectManager: 'Manager A', email: A.email }] },
      ],
      [{ normalizedKey: normalizeObservedManagerLabel('Manager A'), email: A.email }],
    );
    const r = await svc.resolverForProcess('proc-1', TENANT);
    assert.equal(
      r.levelFor(managerKey('Manager A', A.email), X),
      2,
      'directory folds both runs into one identity → L2',
    );
  });

  it('email identity wins over name (managerKey parity with aggregator)', async () => {
    const svc = buildService([
      { findingsHash: 'w1', issues: [{ issueKey: X, projectManager: 'A. Manager', email: A.email }] },
      { findingsHash: 'w2', issues: [{ issueKey: X, projectManager: 'Manager A', email: A.email }] },
    ]);
    const r = await svc.resolverForProcess('proc-1', TENANT);
    // Different display names, same email → same identity → L2.
    assert.equal(r.levelFor(managerKey('whatever', A.email), X), 2);
  });
});
