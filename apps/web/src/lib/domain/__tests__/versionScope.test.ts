import { describe, expect, it } from 'vitest';
import type { AuditProcess, AuditResult, AuditVersion, WorkbookFile } from '../types';
import { selectFunctionVersions, versionFunctionId } from '../versionScope';

function mkResult(fileId: string): AuditResult {
  return { fileId, runAt: '', scannedRows: 0, flaggedRows: 0, issues: [], sheets: [] };
}

function mkFile(id: string, functionId: string): WorkbookFile {
  return { id, functionId } as unknown as WorkbookFile;
}

function mkVersion(
  id: string,
  versionNumber: number,
  fileId: string,
  functionId?: string,
): AuditVersion {
  return {
    id,
    versionId: id,
    versionNumber,
    versionName: `V${versionNumber} (${functionId ?? fileId})`,
    notes: '',
    createdAt: new Date(2026, 0, versionNumber).toISOString(),
    result: mkResult(fileId),
    ...(functionId ? { functionId } : {}),
  };
}

function mkProcess(files: WorkbookFile[], versions: AuditVersion[]): AuditProcess {
  return { id: 'p1', name: 'Demo', files, versions } as unknown as AuditProcess;
}

describe('versionFunctionId', () => {
  const process = mkProcess(
    [mkFile('f-md', 'master-data'), mkFile('f-fr', 'function-rate')],
    [],
  );

  it('prefers the explicit functionId', () => {
    expect(versionFunctionId(process, mkResult('f-md'), 'function-rate')).toBe('function-rate');
  });

  it('derives from the audited file when no explicit functionId', () => {
    expect(versionFunctionId(process, mkResult('f-fr'))).toBe('function-rate');
  });

  it('falls back to master-data when the file is unknown', () => {
    expect(versionFunctionId(process, mkResult('does-not-exist'))).toBe('master-data');
  });
});

describe('selectFunctionVersions — independent versioning per function', () => {
  // master-data has v1,v2 (head v2); function-rate has only its own v1.
  const files = [mkFile('f-md', 'master-data'), mkFile('f-fr', 'function-rate')];
  const versions: AuditVersion[] = [
    mkVersion('mdv2', 2, 'f-md', 'master-data'), // newest-first order
    mkVersion('frv1', 1, 'f-fr', 'function-rate'),
    mkVersion('mdv1', 1, 'f-md', 'master-data'),
  ];
  const process = mkProcess(files, versions);

  it('returns only the requested function versions, newest-first', () => {
    const md = selectFunctionVersions(process, 'master-data');
    expect(md.map((v) => v.id)).toEqual(['mdv2', 'mdv1']);
  });

  it('function-rate head is its OWN v1 even though master-data is at v2 (the bug)', () => {
    const fr = selectFunctionVersions(process, 'function-rate');
    expect(fr).toHaveLength(1);
    expect(fr[0]!.id).toBe('frv1');
    expect(fr[0]!.versionNumber).toBe(1);
  });

  it('a function with no versions yields an empty list', () => {
    expect(selectFunctionVersions(process, 'over-planning')).toEqual([]);
  });

  it('buckets an optimistic version (no functionId) via its audited file', () => {
    const optimistic = mkVersion('opt', 3, 'f-fr'); // no explicit functionId
    const p = mkProcess(files, [optimistic, ...versions]);
    expect(selectFunctionVersions(p, 'function-rate').map((v) => v.id)).toEqual(['opt', 'frv1']);
    expect(selectFunctionVersions(p, 'master-data').map((v) => v.id)).toEqual(['mdv2', 'mdv1']);
  });
});
