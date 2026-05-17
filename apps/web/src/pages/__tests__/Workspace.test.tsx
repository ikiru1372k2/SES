import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import { ConfirmProvider } from '../../components/shared/ConfirmProvider';
import type { AuditProcess, AuditVersion, WorkbookFile } from '../../lib/domain/types';

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
  sheets: [
    {
      id: 's-ws',
      displayCode: 'SHT-WS',
      name: 'Sheet 1',
      status: 'valid',
      rowCount: 3,
      isSelected: true,
      headerRowIndex: 0,
      originalHeaders: [],
      normalizedHeaders: [],
    },
  ],
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

type GateMock = {
  loading: boolean;
  error: boolean;
  permission: 'viewer' | 'editor' | 'owner';
  scopes: Array<{ scopeType: string; functionId: string | null; accessLevel: string }>;
  isOwner: boolean;
  canViewFunction: (fid: string | null | undefined) => boolean;
  canEditFunction: (fid: string | null | undefined) => boolean;
  canViewEscalations: boolean;
  canEditEscalations: boolean;
  canEditAllFunctions: boolean;
};

const defaultGate: GateMock = {
  loading: false,
  error: false,
  permission: 'editor',
  scopes: [],
  isOwner: false,
  canViewFunction: () => true,
  canEditFunction: () => true,
  canViewEscalations: true,
  canEditEscalations: true,
  canEditAllFunctions: true,
};

const accessGateMock = vi.fn(() => defaultGate);

vi.mock('../../hooks/useEffectiveAccess', () => ({
  useEffectiveAccess: (...args: unknown[]) => accessGateMock(...(args as [])),
}));

import { useAppStore } from '../../store/useAppStore';

describe('Workspace', () => {
  beforeEach(() => {
    accessGateMock.mockImplementation(() => defaultGate);
  });
  afterEach(() => {
    accessGateMock.mockReset();
  });

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
    clearCurrentAuditResult: vi.fn(),
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
    expect(screen.getAllByText('hydrated.xlsx').length).toBeGreaterThan(0);
  });

  it('does not expose a members-share trigger anywhere in the workspace', () => {
    vi.mocked(useAppStore).mockImplementation((selector) => selector({ ...baseStore } as never));
    renderWorkspaceAt('/processes/p-ws/over-planning');
    // Members management has been migrated to the dashboard process card.
    expect(screen.queryByRole('button', { name: /^members$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /share process/i })).toBeNull();
  });

  it('disables FilesSidebar Upload when the user has function-viewer scope', () => {
    const viewerGate: GateMock = {
      loading: false,
      error: false,
      permission: 'editor',
      scopes: [{ scopeType: 'function', functionId: 'over-planning', accessLevel: 'viewer' }],
      isOwner: false,
      canViewFunction: () => true,
      canEditFunction: () => false,
      canViewEscalations: false,
      canEditEscalations: false,
      canEditAllFunctions: false,
    };
    accessGateMock.mockImplementation(() => viewerGate);
    vi.mocked(useAppStore).mockImplementation((selector) => selector({ ...baseStore } as never));
    renderWorkspaceAt('/processes/p-ws/over-planning');
    // The Upload <input> on the sidebar should be disabled, and the wrapping
    // label should advertise read-only via aria-disabled.
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    expect(fileInput!.disabled).toBe(true);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('keeps FilesSidebar Upload enabled when the user has editor scope (default mock)', () => {
    vi.mocked(useAppStore).mockImplementation((selector) => selector({ ...baseStore } as never));
    renderWorkspaceAt('/processes/p-ws/over-planning');
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    expect(fileInput!.disabled).toBe(false);
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

  it('hydrates when route changes from a loaded process to a missing process', async () => {
    const hydrateProcesses = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({
        ...baseStore,
        processes: [mockProcess],
        hydrateProcesses,
      } as never),
    );
    const router = createMemoryRouter(
      [{ path: '/processes/:processId/:functionId', element: <Workspace /> }],
      { initialEntries: ['/processes/p-ws/over-planning'] },
    );

    render(withQueryClient(<RouterProvider router={router} />));
    expect(hydrateProcesses).not.toHaveBeenCalled();

    await act(async () => {
      await router.navigate('/processes/missing-b/over-planning');
    });
    await waitFor(() => expect(hydrateProcesses).toHaveBeenCalledTimes(1));
  });
});
