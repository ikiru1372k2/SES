import { render, screen } from '@testing-library/react';
import { NotificationsTab } from '../src/components/workspace/NotificationsTab';
import type { AuditProcess, AuditResult } from '../src/lib/types';

const process: AuditProcess = {
  id: 'process-1',
  name: 'May Audit',
  description: '',
  createdAt: '2026-04-16T00:00:00.000Z',
  updatedAt: '2026-04-16T00:00:00.000Z',
  nextAuditDue: null,
  files: [],
  activeFileId: null,
  versions: [],
  auditPolicy: {
    highEffortThreshold: 900,
    mediumEffortMin: 400,
    mediumEffortMax: 800,
    lowEffortMin: 1,
    lowEffortMax: 399,
    lowEffortEnabled: false,
    zeroEffortEnabled: true,
    missingEffortEnabled: true,
    missingManagerEnabled: true,
    inPlanningEffortEnabled: true,
    onHoldEffortEnabled: true,
    onHoldEffortThreshold: 200,
    updatedAt: '2026-04-16T00:00:00.000Z',
  },
  notificationTracking: {},
  comments: {},
  corrections: {},
};

const result: AuditResult = {
  fileId: 'file-1',
  runAt: '2026-04-16T00:00:00.000Z',
  scannedRows: 1,
  flaggedRows: 1,
  sheets: [{ sheetName: 'Effort', rowCount: 1, flaggedCount: 1 }],
  issues: [{
    id: 'issue-1',
    projectNo: '<P-1>',
    projectName: '<img src=x onerror=alert(1)>',
    sheetName: 'Effort',
    severity: 'High',
    projectManager: '<script>alert(1)</script>',
    projectState: 'Authorised',
    effort: 999,
    auditStatus: 'HIGH EFFORT',
    notes: '<b>unsafe</b>',
    rowIndex: 1,
  }],
};

test('notification preview renders workbook text as safe content', () => {
  render(<NotificationsTab process={process} result={result} />);

  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  expect(screen.getByText('<b>unsafe</b>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
});
