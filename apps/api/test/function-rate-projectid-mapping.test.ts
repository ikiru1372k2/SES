import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { AuditsService } from '../src/audits.service';
import type { AuditIssue } from '@ses/domain';

// Minimal AuditsService instance — exercises only the two private methods
// added by the function-rate Project-ID mapping fix. Constructor deps stay
// nulled because neither method touches them.
function makeService(): AuditsService {
  return new AuditsService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
}

// Reach past `private` for targeted unit tests — enforced at compile, not runtime.
type Private = {
  buildProjectIdToManagerMap: (
    tx: unknown,
    process: { id: string; displayCode: string },
    auditFile: { id: string },
    src: unknown,
  ) => Promise<Map<string, string>>;
  applyProjectIdToManager: (issues: AuditIssue[], map: Map<string, string>) => number;
  prepareIssuesForPersistence: (
    issues: AuditIssue[],
    processDisplayCode: string,
    displayCodes: string[],
  ) => Array<AuditIssue & { persistedId: string; displayCode: string; issueKey: string }>;
  assertKnownRuleCodes: (
    issues: Array<{ persistedId: string; ruleCode?: string | null; ruleId?: string | null }>,
    validRuleCodes: Set<string>,
  ) => void;
};

function priv(svc: AuditsService): Private {
  return svc as unknown as Private;
}

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: 'iss-1',
    projectNo: 'FR-001',
    projectName: 'p',
    sheetName: 'Rates',
    severity: 'High',
    projectManager: 'Unassigned',
    projectState: 'Unknown',
    effort: 1,
    auditStatus: 'RUL-FR-RATE-ZERO',
    notes: '',
    rowIndex: 1,
    ...overrides,
  };
}

// ─── applyProjectIdToManager ─────────────────────────────────────────────

describe('applyProjectIdToManager', () => {
  it('populates projectManager from a Project ID map when the row lacks one', () => {
    const svc = makeService();
    const issues = [makeIssue({ projectNo: 'FR-001', projectManager: 'Unassigned' })];
    const map = new Map([['fr-001', 'Wagner, Anna']]);
    const count = priv(svc).applyProjectIdToManager(issues, map);
    assert.equal(count, 1);
    assert.equal(issues[0]!.projectManager, 'Wagner, Anna');
  });

  it('normalizes Project ID casing/whitespace on lookup', () => {
    const svc = makeService();
    const issues = [makeIssue({ projectNo: '  FR-001 ', projectManager: '' })];
    const map = new Map([['fr-001', 'Wagner, Anna']]);
    const count = priv(svc).applyProjectIdToManager(issues, map);
    assert.equal(count, 1);
    assert.equal(issues[0]!.projectManager, 'Wagner, Anna');
  });

  it('does NOT overwrite an already-populated manager name', () => {
    const svc = makeService();
    const issues = [makeIssue({ projectNo: 'FR-001', projectManager: 'Smith, John' })];
    const map = new Map([['fr-001', 'Wagner, Anna']]);
    const count = priv(svc).applyProjectIdToManager(issues, map);
    assert.equal(count, 0);
    assert.equal(issues[0]!.projectManager, 'Smith, John');
  });

  it('treats "Unassigned" (any case) as empty and overwrites it', () => {
    const svc = makeService();
    const issues = [makeIssue({ projectNo: 'FR-001', projectManager: 'UNASSIGNED' })];
    const map = new Map([['fr-001', 'Wagner, Anna']]);
    const count = priv(svc).applyProjectIdToManager(issues, map);
    assert.equal(count, 1);
    assert.equal(issues[0]!.projectManager, 'Wagner, Anna');
  });

  it('leaves issues unresolved when the map has no match (fallback preserved)', () => {
    const svc = makeService();
    const issues = [
      makeIssue({ id: 'iss-1', projectNo: 'FR-999', projectManager: 'Unassigned' }),
    ];
    const map = new Map([['fr-001', 'Wagner, Anna']]);
    const count = priv(svc).applyProjectIdToManager(issues, map);
    assert.equal(count, 0);
    // Issue still exists — escalation pipeline handles unresolved downstream.
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.projectManager, 'Unassigned');
  });

  it('returns 0 and is a no-op when the map is empty', () => {
    const svc = makeService();
    const issues = [makeIssue({ projectNo: 'FR-001', projectManager: 'Unassigned' })];
    const count = priv(svc).applyProjectIdToManager(issues, new Map());
    assert.equal(count, 0);
    assert.equal(issues[0]!.projectManager, 'Unassigned');
  });

  it('skips issues with blank Project ID', () => {
    const svc = makeService();
    const issues = [makeIssue({ projectNo: '', projectManager: 'Unassigned' })];
    const map = new Map([['fr-001', 'Wagner, Anna']]);
    const count = priv(svc).applyProjectIdToManager(issues, map);
    assert.equal(count, 0);
  });
});

describe('audit issue persistence guards', () => {
  it('assigns fresh persisted ids for each saved issue so reruns do not reuse engine ids', () => {
    const svc = makeService();
    const sourceIssues = [
      makeIssue({ id: 'engine-issue-1', projectNo: 'FR-001', sheetName: 'Sheet1', rowIndex: 1, auditStatus: 'RUL-FR-RATE-ZERO' }),
      makeIssue({ id: 'engine-issue-1', projectNo: 'FR-002', sheetName: 'Sheet1', rowIndex: 2, auditStatus: 'RUL-FR-RATE-ZERO' }),
    ];
    const persisted = priv(svc).prepareIssuesForPersistence(sourceIssues, 'PRC-1', ['ISS-1', 'ISS-2']);

    assert.equal(persisted.length, 2);
    assert.equal(persisted[0]!.displayCode, 'ISS-1');
    assert.equal(persisted[1]!.displayCode, 'ISS-2');
    assert.notEqual(persisted[0]!.persistedId, sourceIssues[0]!.id);
    assert.notEqual(persisted[1]!.persistedId, sourceIssues[1]!.id);
    assert.notEqual(persisted[0]!.persistedId, persisted[1]!.persistedId);
    assert.match(persisted[0]!.issueKey, /^IKY-/);
    assert.match(persisted[1]!.issueKey, /^IKY-/);
  });

  it('throws BadRequestException when an audit emits an unknown rule code', () => {
    const svc = makeService();
    assert.throws(
      () =>
        priv(svc).assertKnownRuleCodes(
          [{ persistedId: 'iss-1', ruleCode: 'RUL-NOT-SEEDED' }],
          new Set(['RUL-MD-MISSING-EFFORT']),
        ),
      (err: unknown) => err instanceof BadRequestException,
    );
  });
});

// ─── buildProjectIdToManagerMap — uploaded_file ─────────────────────────

describe('buildProjectIdToManagerMap — uploaded_file', () => {
  function fakeTxWithFile(opts: {
    fileExists: boolean;
    fileProcessId?: string;
    rows?: unknown[][];
  }) {
    const { fileExists, fileProcessId = 'proc-1', rows = [] } = opts;
    return {
      workbookFile: {
        findFirst: async ({ where }: { where: { id: string; processId: string } }) =>
          fileExists && where.processId === fileProcessId ? { id: where.id } : null,
      },
      workbookSheet: {
        findFirst: async () => ({ rows }),
      },
    };
  }

  it('builds Project ID → Manager map from a two-column uploaded file', async () => {
    const svc = makeService();
    const tx = fakeTxWithFile({
      fileExists: true,
      rows: [
        ['Project ID', 'Project Manager'],
        ['FR-001', 'Wagner, Anna'],
        ['FR-002', 'Smith, John'],
      ],
    });
    const map = await priv(svc).buildProjectIdToManagerMap(
      tx,
      { id: 'proc-1', displayCode: 'PRC-1' },
      { id: 'audit-file-1' },
      { type: 'uploaded_file', uploadId: 'map-file-1' },
    );
    assert.equal(map.size, 2);
    assert.equal(map.get('fr-001'), 'Wagner, Anna');
    assert.equal(map.get('fr-002'), 'Smith, John');
  });

  it('accepts header synonyms "Project No." and "Manager"', async () => {
    const svc = makeService();
    const tx = fakeTxWithFile({
      fileExists: true,
      rows: [
        ['Project No.', 'Manager'],
        ['FR-001', 'Wagner, Anna'],
      ],
    });
    const map = await priv(svc).buildProjectIdToManagerMap(
      tx,
      { id: 'proc-1', displayCode: 'PRC-1' },
      { id: 'audit-file-1' },
      { type: 'uploaded_file', uploadId: 'map-file-1' },
    );
    assert.equal(map.get('fr-001'), 'Wagner, Anna');
  });

  it('returns an empty map when required headers are missing', async () => {
    const svc = makeService();
    const tx = fakeTxWithFile({
      fileExists: true,
      rows: [
        ['Project ID', 'Email only'],
        ['FR-001', 'anna@x.com'],
      ],
    });
    const map = await priv(svc).buildProjectIdToManagerMap(
      tx,
      { id: 'proc-1', displayCode: 'PRC-1' },
      { id: 'audit-file-1' },
      { type: 'uploaded_file', uploadId: 'map-file-1' },
    );
    assert.equal(map.size, 0);
  });

  it('rejects using the audit file as its own mapping source', async () => {
    const svc = makeService();
    const tx = fakeTxWithFile({ fileExists: true });
    await assert.rejects(
      () =>
        priv(svc).buildProjectIdToManagerMap(
          tx,
          { id: 'proc-1', displayCode: 'PRC-1' },
          { id: 'same-file' },
          { type: 'uploaded_file', uploadId: 'same-file' },
        ),
      (err: unknown) => err instanceof BadRequestException,
    );
  });

  it('rejects when the mapping file is not in the same process (same-process guard)', async () => {
    const svc = makeService();
    const tx = fakeTxWithFile({ fileExists: false });
    await assert.rejects(
      () =>
        priv(svc).buildProjectIdToManagerMap(
          tx,
          { id: 'proc-1', displayCode: 'PRC-1' },
          { id: 'audit-file-1' },
          { type: 'uploaded_file', uploadId: 'map-from-other-process' },
        ),
      (err: unknown) => err instanceof BadRequestException,
    );
  });

  it('returns an empty map when uploadId is missing', async () => {
    const svc = makeService();
    const tx = fakeTxWithFile({ fileExists: true });
    const map = await priv(svc).buildProjectIdToManagerMap(
      tx,
      { id: 'proc-1', displayCode: 'PRC-1' },
      { id: 'audit-file-1' },
      { type: 'uploaded_file' },
    );
    assert.equal(map.size, 0);
  });
});

// ─── buildProjectIdToManagerMap — master_data_version ───────────────────

describe('buildProjectIdToManagerMap — master_data_version', () => {
  function fakeTxWithMdRun(opts: {
    runExists: boolean;
    issues?: Array<{ projectNo: string | null; projectManager: string | null }>;
  }) {
    const { runExists, issues = [] } = opts;
    return {
      auditRun: {
        findFirst: async () => (runExists ? { id: 'md-run-1' } : null),
      },
      auditIssue: {
        findMany: async () => issues,
      },
    };
  }

  it('builds Project ID → Manager map from a completed MD run', async () => {
    const svc = makeService();
    const tx = fakeTxWithMdRun({
      runExists: true,
      issues: [
        { projectNo: 'FR-001', projectManager: 'Wagner, Anna' },
        { projectNo: 'FR-002', projectManager: 'Smith, John' },
      ],
    });
    const map = await priv(svc).buildProjectIdToManagerMap(
      tx,
      { id: 'proc-1', displayCode: 'PRC-1' },
      { id: 'audit-file-1' },
      { type: 'master_data_version', masterDataVersionId: 'md-run-1' },
    );
    assert.equal(map.size, 2);
    assert.equal(map.get('fr-001'), 'Wagner, Anna');
    assert.equal(map.get('fr-002'), 'Smith, John');
  });

  it('first occurrence wins when the MD run has duplicate Project IDs', async () => {
    const svc = makeService();
    const tx = fakeTxWithMdRun({
      runExists: true,
      issues: [
        { projectNo: 'FR-001', projectManager: 'Wagner, Anna' },
        { projectNo: 'FR-001', projectManager: 'Second, Duplicate' },
      ],
    });
    const map = await priv(svc).buildProjectIdToManagerMap(
      tx,
      { id: 'proc-1', displayCode: 'PRC-1' },
      { id: 'audit-file-1' },
      { type: 'master_data_version', masterDataVersionId: 'md-run-1' },
    );
    assert.equal(map.get('fr-001'), 'Wagner, Anna');
  });

  it('rejects when the MD version does not belong to this process / is not completed', async () => {
    const svc = makeService();
    const tx = fakeTxWithMdRun({ runExists: false });
    await assert.rejects(
      () =>
        priv(svc).buildProjectIdToManagerMap(
          tx,
          { id: 'proc-1', displayCode: 'PRC-1' },
          { id: 'audit-file-1' },
          { type: 'master_data_version', masterDataVersionId: 'bogus-run' },
        ),
      (err: unknown) => err instanceof BadRequestException,
    );
  });

  it('returns empty when masterDataVersionId is missing', async () => {
    const svc = makeService();
    const tx = fakeTxWithMdRun({ runExists: true });
    const map = await priv(svc).buildProjectIdToManagerMap(
      tx,
      { id: 'proc-1', displayCode: 'PRC-1' },
      { id: 'audit-file-1' },
      { type: 'master_data_version' },
    );
    assert.equal(map.size, 0);
  });
});
