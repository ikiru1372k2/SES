import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuditSchedule } from '../src/components/dashboard/AuditSchedule';
import { NotificationsTab } from '../src/components/workspace/NotificationsTab';
import type { AuditProcess, AuditResult } from '../src/lib/domain/types';

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
  acknowledgments: {},
  savedTemplates: {},
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
  fireEvent.click(screen.getByRole('button', { name: 'Per-manager drafts' }));

  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  expect(screen.getByText('<b>unsafe</b>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
});

test('notification preview renders pending correction context', () => {
  render(<NotificationsTab process={{
    ...process,
    corrections: {
      '<P-1>|Effort|1': {
        issueKey: '<P-1>|Effort|1',
        processId: process.id,
        effort: 850,
        note: 'Capacity cap',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    },
  }} result={result} />);
  fireEvent.click(screen.getByRole('button', { name: 'Per-manager drafts' }));

  expect(screen.getByText(/999h/)).toBeInTheDocument();
  expect(screen.getByText(/850h/)).toBeInTheDocument();
  expect(screen.getByText('Capacity cap')).toBeInTheDocument();
});

test('audit schedule renders overdue and upcoming buckets', () => {
  const today = new Date();
  const date = (offset: number) => {
    const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  };

  render(
    <MemoryRouter>
      <AuditSchedule processes={[
        { ...process, id: 'overdue', name: 'Overdue Audit', nextAuditDue: date(-1) },
        { ...process, id: 'soon', name: 'Soon Audit', nextAuditDue: date(4) },
        { ...process, id: 'upcoming', name: 'Upcoming Audit', nextAuditDue: date(24) },
      ]} />
    </MemoryRouter>,
  );

  expect(screen.getByText('Overdue')).toBeInTheDocument();
  expect(screen.getByText('Due this week')).toBeInTheDocument();
  expect(screen.getByText('Upcoming')).toBeInTheDocument();
  expect(screen.getByText('Overdue Audit')).toBeInTheDocument();
});
