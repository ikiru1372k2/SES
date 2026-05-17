import { describe, expect, it } from 'vitest';
import type { AuditProcess, AuditResult, WorkbookFile } from '../../domain/types';
import {
  EMPTY_AUDIT_METRICS,
  computeAuditMetrics,
  filterAuditResultBySelectedSheets,
  getSelectedSheetNames,
  resolveWorkspaceMetrics,
} from '../auditResultFilter';

function sheet(name: string, isSelected: boolean) {
  return {
    id: `s-${name}`,
    displayCode: `SHT-${name}`,
    name,
    status: 'valid' as const,
    rowCount: 10,
    isSelected,
    headerRowIndex: 0,
    originalHeaders: [],
    normalizedHeaders: [],
  };
}

function makeFile(sheets: ReturnType<typeof sheet>[]): WorkbookFile {
  return {
    id: 'file-1',
    name: 'test.xlsx',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    lastAuditedAt: null,
    isAudited: true,
    functionId: 'master-data',
    sheets,
    rawData: {},
  };
}

const baseResult: AuditResult = {
  fileId: 'file-1',
  runAt: '2026-01-02T00:00:00.000Z',
  scannedRows: 20,
  flaggedRows: 4,
  issues: [
    {
      id: 'i1',
      projectNo: 'P1',
      projectName: 'A',
      sheetName: 'SheetA',
      severity: 'High',
      projectManager: 'M',
      projectState: 'Open',
      effort: 1,
      auditStatus: 'rule',
      notes: '',
      rowIndex: 1,
      ruleCode: 'RUL-MD-001',
    },
    {
      id: 'i2',
      projectNo: 'P2',
      projectName: 'B',
      sheetName: 'SheetB',
      severity: 'Medium',
      projectManager: 'M',
      projectState: 'Open',
      effort: 1,
      auditStatus: 'rule',
      notes: '',
      rowIndex: 2,
      ruleCode: 'RUL-MD-002',
    },
  ],
  sheets: [
    { sheetName: 'SheetA', rowCount: 10, flaggedCount: 2 },
    { sheetName: 'SheetB', rowCount: 10, flaggedCount: 2 },
  ],
};

describe('getSelectedSheetNames', () => {
  it('returns only valid selected sheet names', () => {
    const file = makeFile([sheet('SheetA', true), sheet('SheetB', false)]);
    expect(getSelectedSheetNames(file)).toEqual(new Set(['SheetA']));
  });
});

describe('filterAuditResultBySelectedSheets', () => {
  it('returns null when result file does not match active file', () => {
    const file = makeFile([sheet('SheetA', true)]);
    const result = { ...baseResult, fileId: 'other-file' };
    expect(filterAuditResultBySelectedSheets(result, file)).toBeNull();
  });

  it('returns zeros when no sheets are selected', () => {
    const file = makeFile([sheet('SheetA', false), sheet('SheetB', false)]);
    const filtered = filterAuditResultBySelectedSheets(baseResult, file);
    expect(filtered?.issues).toEqual([]);
    expect(filtered?.sheets).toEqual([]);
    expect(filtered?.scannedRows).toBe(0);
    expect(filtered?.flaggedRows).toBe(0);
    expect(computeAuditMetrics(filtered!).issues).toBe(0);
  });

  it('filters to a single selected sheet', () => {
    const file = makeFile([sheet('SheetA', true), sheet('SheetB', false)]);
    const filtered = filterAuditResultBySelectedSheets(baseResult, file)!;
    expect(filtered.issues).toHaveLength(1);
    expect(filtered.issues[0]?.sheetName).toBe('SheetA');
    expect(filtered.sheets).toHaveLength(1);
    expect(filtered.scannedRows).toBe(10);
    const metrics = computeAuditMetrics(filtered);
    expect(metrics.issues).toBe(1);
    expect(metrics.sheetsAudited).toBe(1);
  });

  it('includes all sheets when all are selected', () => {
    const file = makeFile([sheet('SheetA', true), sheet('SheetB', true)]);
    const filtered = filterAuditResultBySelectedSheets(baseResult, file)!;
    expect(filtered.issues).toHaveLength(2);
    expect(filtered.scannedRows).toBe(20);
    expect(computeAuditMetrics(filtered).issues).toBe(2);
  });
});

function makeProcess(over: Partial<AuditProcess> = {}): AuditProcess {
  return {
    id: 'PRC-1',
    displayCode: 'PRC-1',
    name: 'Proc',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: [],
    versions: [],
    corrections: {},
    ...over,
  } as AuditProcess;
}

describe('resolveWorkspaceMetrics (workspace status bar)', () => {
  it('returns all-zeros when there is no active file', () => {
    const process = makeProcess({
      versions: [
        // A saved version from a deleted/other file must NOT leak in.
        { id: 'v1', versionName: 'V1', createdAt: '2026-01-02T00:00:00.000Z', result: baseResult },
      ],
    } as Partial<AuditProcess>);
    expect(resolveWorkspaceMetrics(process, undefined, baseResult)).toEqual(EMPTY_AUDIT_METRICS);
  });

  it('returns all-zeros when no process', () => {
    expect(resolveWorkspaceMetrics(undefined, undefined, baseResult)).toEqual(EMPTY_AUDIT_METRICS);
  });

  it('does not leak a session result from another file (process switch)', () => {
    const file = makeFile([sheet('SheetA', true), sheet('SheetB', true)]);
    // Session result belongs to a DIFFERENT file (e.g. previous process/file
    // still in the store after navigating by URL).
    const otherFileResult: AuditResult = { ...baseResult, fileId: 'other-file' };
    const process = makeProcess({ files: [file] } as Partial<AuditProcess>);
    expect(resolveWorkspaceMetrics(process, file, otherFileResult)).toEqual(EMPTY_AUDIT_METRICS);
  });

  it('uses the session result when it matches the active file', () => {
    const file = makeFile([sheet('SheetA', true), sheet('SheetB', true)]);
    const process = makeProcess({ files: [file] } as Partial<AuditProcess>);
    const metrics = resolveWorkspaceMetrics(process, file, baseResult);
    expect(metrics.issues).toBe(2);
    expect(metrics.sheetsAudited).toBe(2);
    expect(metrics.scannedRows).toBe(20);
  });
});
