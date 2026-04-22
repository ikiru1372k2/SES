import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import type { AuditProcess, AuditVersion, WorkbookFile } from '../../lib/types';

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

  it('lists hydrated server files in the sidebar', () => {
    vi.mocked(useAppStore).mockImplementation((selector) => selector({ ...baseStore } as never));

    render(
      <MemoryRouter initialEntries={['/processes/p-ws/over-planning']}>
        <Routes>
          <Route path="/processes/:processId/:functionId" element={<Workspace />} />
        </Routes>
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter initialEntries={['/processes/p-ws/over-planning']}>
        <Routes>
          <Route path="/processes/:processId/:functionId" element={<Workspace />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Unsaved draft available/i)).toBeInTheDocument();
    expect(screen.getByText(/draft\.xlsx/i)).toBeInTheDocument();
  });
});
