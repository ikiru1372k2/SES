import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessEscalationManagerRow, ProcessEscalationsPayload } from '@ses/domain';
import { emptyEngineCountRecord } from '@ses/domain';
import { EscalationCenter } from '../EscalationCenter';

vi.mock('../../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock('../../components/auth/authContext', () => ({
  useCurrentUser: () => ({
    id: 'u1',
    displayCode: 'USR-1',
    email: 'me@example.com',
    displayName: 'Me',
    role: 'auditor' as const,
  }),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

import * as rq from '@tanstack/react-query';
import { useAppStore } from '../../store/useAppStore';

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

function baseRow(p: Partial<ProcessEscalationManagerRow> & Pick<ProcessEscalationManagerRow, 'managerKey' | 'managerName'>): ProcessEscalationManagerRow {
  return {
    resolvedEmail: 'mgr@example.com',
    directoryEmail: null,
    directoryTeamsUsername: null,
    isUnmapped: false,
    totalIssues: 1,
    countsByEngine: { 'over-planning': 1 },
    findingsByEngine: {},
    stage: 'open',
    resolved: false,
    lastContactAt: null,
    lastActivityAt: null,
    slaDueAt: null,
    trackingId: 'trk-1',
    trackingDisplayCode: 'TRK-1',
    ...p,
  };
}

describe('EscalationCenter', () => {
  const payload: ProcessEscalationsPayload = {
    processId: 'p-esc',
    engineIds: ['over-planning'] as ProcessEscalationsPayload['engineIds'],
    summary: {
      totalOpenFindings: 4,
      perEngineIssueCounts: { ...emptyEngineCountRecord(), 'over-planning': 4 },
      perEngineManagerCounts: { ...emptyEngineCountRecord(), 'over-planning': 2 },
      managersWithOpenCount: 2,
      engineCountWithOpen: 1,
      slaBreachingCount: 0,
      unmappedManagerCount: 1,
    },
    rows: [
      baseRow({ managerKey: 'k1', managerName: 'Mapped Manager', totalIssues: 3 }),
      baseRow({
        managerKey: 'missing-email:only-name',
        managerName: 'Name Only',
        resolvedEmail: null,
        isUnmapped: true,
        totalIssues: 1,
        countsByEngine: { 'over-planning': 1 },
      }),
    ],
  };

  it('renders summary and route shell for /processes/:processId/escalations', () => {
    vi.mocked(rq.useQuery).mockReturnValue({
      data: payload,
      isError: false,
      error: null,
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({
        processes: [
          {
            id: 'p-esc',
            displayCode: 'PRC-ESC',
            name: 'Escalation test',
            description: '',
            serverBacked: true,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
            nextAuditDue: null,
            files: [],
            activeFileId: null,
            versions: [],
            auditPolicy: policy,
            notificationTracking: {},
            comments: {},
            corrections: {},
            acknowledgments: {},
            savedTemplates: {},
          },
        ],
        hydrateProcesses: vi.fn().mockResolvedValue(undefined),
      } as never),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/processes/p-esc/escalations']}>
          <Routes>
            <Route path="/processes/:processId/escalations" element={<EscalationCenter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Escalation Center' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Open metric')).getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/aren't in the directory/i)).toBeInTheDocument();
  });

  it('opens and closes the manager panel from the table', async () => {
    vi.mocked(rq.useQuery).mockReturnValue({
      data: payload,
      isError: false,
      error: null,
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({
        processes: [
          {
            id: 'p-esc',
            displayCode: 'PRC-ESC',
            name: 'Escalation test',
            description: '',
            serverBacked: true,
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
            nextAuditDue: null,
            files: [],
            activeFileId: null,
            versions: [],
            auditPolicy: policy,
            notificationTracking: {},
            comments: {},
            corrections: {},
            acknowledgments: {},
            savedTemplates: {},
          },
        ],
        hydrateProcesses: vi.fn().mockResolvedValue(undefined),
      } as never),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/processes/p-esc/escalations']}>
          <Routes>
            <Route path="/processes/:processId/escalations" element={<EscalationCenter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('Mapped Manager'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mapped Manager' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
