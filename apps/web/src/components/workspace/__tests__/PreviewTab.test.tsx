import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewTab } from '../PreviewTab';
import type { AuditProcess, WorkbookFile } from '../../../lib/domain/types';

const fetchSheetPreviewFromApi = vi.fn();

vi.mock('../../../lib/api/filesApi', () => ({
  fetchSheetPreviewFromApi: (...args: unknown[]) => fetchSheetPreviewFromApi(...args),
}));

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const file: WorkbookFile = {
  id: 'file-1',
  displayCode: 'FIL-1',
  name: 'shared.xlsx',
  uploadedAt: '2026-04-10T00:00:00.000Z',
  lastAuditedAt: '2026-04-10T00:00:00.000Z',
  isAudited: true,
  functionId: 'master-data',
  rawData: {},
  sheets: [
    {
      id: 'sheet-1',
      displayCode: 'SHT-1',
      name: 'Effort Data',
      status: 'valid',
      rowCount: 1,
      isSelected: true,
      headerRowIndex: 0,
      originalHeaders: [],
      normalizedHeaders: [],
    },
  ],
};

const process: AuditProcess = {
  id: 'process-1',
  displayCode: 'PRC-1',
  name: 'Shared process',
  description: '',
  serverBacked: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  nextAuditDue: null,
  files: [file],
  activeFileId: file.id,
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
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  notificationTracking: {},
  comments: {},
  corrections: {},
  acknowledgments: {},
  savedTemplates: {},
};

afterEach(() => {
  fetchSheetPreviewFromApi.mockReset();
});

describe('PreviewTab', () => {
  it('loads preview rows from the API when a shared server-backed file has no local rawData', async () => {
    fetchSheetPreviewFromApi.mockResolvedValue({
      fileId: 'file-1',
      fileCode: 'FIL-1',
      sheetName: 'Effort Data',
      sheetCode: 'SHT-1',
      page: 1,
      pageSize: 100,
      totalRows: 1,
      headerRowIndex: 0,
      headers: ['Project No.', 'Project'],
      rows: [{ rowIndex: 1, values: ['90032101', 'Digital Core SAP S4'] }],
    });

    renderWithQuery(<PreviewTab process={process} file={file} result={null} />);

    await waitFor(() => expect(fetchSheetPreviewFromApi).toHaveBeenCalledWith('FIL-1', 'SHT-1', expect.any(Object)));
    expect(await screen.findByText('Digital Core SAP S4')).toBeInTheDocument();
  });
});
