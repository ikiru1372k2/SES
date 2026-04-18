import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { downloadAuditedWorkbook } from '../src/workbook.js';
import type { AuditResult, WorkbookFile } from '../src/types.js';

test('corrected workbook export adds correction columns without overwriting source values', async () => {
  const capturedBlob: { current: Blob | null } = { current: null };
  let downloadName = '';
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  const fakeUrl = {
    ...URL,
    createObjectURL: (blob: Blob) => {
      capturedBlob.current = blob;
      return 'blob:test';
    },
    revokeObjectURL: () => undefined,
  };
  const fakeDocument = {
    createElement: () => ({
      href: '',
      set download(value: string) {
        downloadName = value;
      },
      click: () => undefined,
    }),
  };
  (globalThis as unknown as { URL: typeof URL; document: Document }).URL = fakeUrl as unknown as typeof URL;
  (globalThis as unknown as { document: Document }).document = fakeDocument as unknown as Document;

  try {
    const file: WorkbookFile = {
      id: 'file-1',
      name: 'effort.xlsx',
      uploadedAt: '2026-04-16T00:00:00.000Z',
      lastAuditedAt: null,
      isAudited: true,
      sheets: [{ name: 'Effort', status: 'valid', rowCount: 1, isSelected: true, headerRowIndex: 0 }],
      rawData: {
        Effort: [
          ['Project No.', 'Project', 'Project State', 'Project Manager', 'Effort (H)'],
          ['P-1', 'Core', 'Authorised', 'Manager One', 920],
        ],
      },
    };
    const result: AuditResult = {
      fileId: 'file-1',
      runAt: '2026-04-16T00:00:00.000Z',
      scannedRows: 1,
      flaggedRows: 1,
      sheets: [{ sheetName: 'Effort', rowCount: 1, flaggedCount: 1 }],
      issues: [{
        id: 'issue-1',
        projectNo: 'P-1',
        projectName: 'Core',
        sheetName: 'Effort',
        severity: 'High',
        projectManager: 'Manager One',
        projectState: 'Authorised',
        effort: 920,
        auditStatus: 'HIGH',
        notes: 'Too high',
        rowIndex: 1,
      }],
    };

    await downloadAuditedWorkbook(file, result, {
      'P-1|Effort|1': {
        issueKey: 'P-1|Effort|1',
        processId: 'process-1',
        effort: 850,
        projectState: 'Authorised',
        projectManager: 'Manager One',
        note: 'Capacity cap',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    });

    assert.equal(downloadName, 'effort_corrected.xlsx');
    const blob = capturedBlob.current;
    assert.ok(blob);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const worksheet = workbook.getWorksheet('Effort');
    assert.ok(worksheet);
    assert.equal(worksheet.getRow(1).getCell(6).value, 'Audit Severity');
    assert.equal(worksheet.getRow(1).getCell(9).value, 'Corrected State');
    assert.equal(worksheet.getRow(2).getCell(5).value, 920);
    assert.equal(worksheet.getRow(2).getCell(8).value, 850);
    assert.equal(worksheet.getRow(2).getCell(9).value, 'Authorised');
    assert.equal(worksheet.getRow(2).getCell(11).value, 'Capacity cap');
  } finally {
    (globalThis as unknown as { URL: typeof URL }).URL = originalUrl;
    (globalThis as unknown as { document: Document | undefined }).document = originalDocument;
  }
});
