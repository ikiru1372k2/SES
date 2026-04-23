import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import { ConfirmProvider } from '../../components/shared/ConfirmProvider';
import type { AuditProcess, AuditVersion, WorkbookFile } from '../../lib/types';

// Issue #74: Workspace now uses useQuery for the unmapped-manager banner,
// so tests must wrap it in a QueryClientProvider. Retries off to keep
// failures deterministic. FilesSidebar also uses useConfirm() now.
function withQueryClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </QueryClientProvider>
  );
}

const policy = {
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
};

const file: WorkbookFile = {
  id: 'f-ws',
  name: 'hydrated.xlsx',
  uploadedAt: '2026-04-10T12:00:00.000Z',
  lastAuditedAt: null,
  isAudited: false,
  functionId: 'over-planning',
  sheets: [],
  rawData: {},
};

const mockProcess: AuditProcess = {
  id: 'p-ws',
  displayCode: 'PRC-WS',
  name: 'Workspace test',
  description: '',
  serverBacked: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  nextAuditDue: null,
  files: [file],
  activeFileId: 'f-ws',
  versions: [] as AuditVersion[],
  auditPolicy: policy,
  notificationTracking: {},
  comments: {},
  corrections: {},
  acknowledgments: {},
  savedTemplates: {},
};

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../../components/auth/authContext', () => ({
  useCurrentUser: () => ({
    id: 'u1',
    displayCode: 'USR-1',
    email: 'u@example.com',
    displayName: 'User',
    role: 'auditor' as const,
  }),
}));

vi.mock('../../realtime/useRealtime', () => ({
  useRealtime: () => ({ members: [] }),
}));

vi.mock('../../lib/api/directoryApi', () => ({
  directorySuggestions: vi.fn().mockResolvedValue({ results: {} }),
}));

import { useAppStore } from '../../store/useAppStore';

describe('Workspace', () => {
  const baseStore = {
    processes: [mockProcess],
    hydrateProcesses: vi.fn().mockResolvedValue(undefined),
    hydrateFunctionWorkspace: vi.fn().mockResolvedValue(undefined),
    fileDrafts: {} as Record<string, { updatedAt?: string; fileName?: string }>,
    promoteFileDraft: vi.fn(),
    discardFileDraft: vi.fn(),
    activeWorkspaceTab: 'preview' as const,
    currentAuditResult: null,
    uploads: {},
    uploadFile: vi.fn(),
    setActiveFile: vi.fn(),
    setWorkspaceTab: vi.fn(),
    deleteFile: vi.fn(),
    saveFileDraft: vi.fn(),
  };

  function renderWorkspaceAt(path: string) {
    const router = createMemoryRouter(
      [{ path: '/processes/:processId/:functionId', element: <Workspace /> }],
      { initialEntries: [path] },
    );
    return render(withQueryClient(<RouterProvider router={router} />));
  }

  it('lists hydrated server files in the sidebar', () => {
    vi.mocked(useAppStore).mockImplementation((selector) => selector({ ...baseStore } as never));
    renderWorkspaceAt('/processes/p-ws/over-planning');
    expect(screen.getByText('hydrated.xlsx')).toBeInTheDocument();
  });

  it('shows the draft restore banner when draft metadata is newer than the active file', () => {
    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({
        ...baseStore,
        fileDrafts: {
          'p-ws:over-planning': {
            hasDraft: true,
            fileName: 'draft.xlsx',
            updatedAt: '2026-04-12T12:00:00.000Z',
          },
        },
      } as never),
    );
    renderWorkspaceAt('/processes/p-ws/over-planning');
    expect(screen.getByText(/Unsaved draft available/i)).toBeInTheDocument();
    expect(screen.getByText(/draft\.xlsx/i)).toBeInTheDocument();
  });
});
