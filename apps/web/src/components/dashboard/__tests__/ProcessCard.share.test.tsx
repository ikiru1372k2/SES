import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessCard } from '../ProcessCard';
import { ConfirmProvider } from '../../shared/ConfirmProvider';
import type { AuditProcess, AuditVersion, WorkbookFile } from '../../../lib/types';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

vi.mock('../../auth/authContext', () => ({
  useCurrentUser: () => ({
    id: 'u1',
    displayCode: 'USR-1',
    email: 'u@example.com',
    displayName: 'User',
    role: 'admin' as const,
  }),
}));

vi.mock('../../../lib/api/membersApi', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
}));

import { useAppStore } from '../../../store/useAppStore';

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

function makeProcess(overrides: Partial<AuditProcess> = {}): AuditProcess {
  return {
    id: 'p-card',
    displayCode: 'PRC-CARD',
    name: 'Card test process',
    description: '',
    serverBacked: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    nextAuditDue: null,
    files: [] as WorkbookFile[],
    activeFileId: null,
    versions: [] as AuditVersion[],
    auditPolicy: policy,
    notificationTracking: {},
    comments: {},
    corrections: {},
    acknowledgments: {},
    savedTemplates: {},
    ...overrides,
  };
}

function renderCard(process: AuditProcess) {
  return render(
    <ConfirmProvider>
      <MemoryRouter>
        <ProcessCard process={process} />
      </MemoryRouter>
    </ConfirmProvider>,
  );
}

describe('ProcessCard — share entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({
        deleteProcess: vi.fn(),
        updateProcess: vi.fn(),
      } as never),
    );
  });

  it('renders an accessible share button on a server-backed process card', () => {
    renderCard(makeProcess());
    expect(screen.getByRole('button', { name: /share process/i })).toBeInTheDocument();
  });

  it('does not render the share button on a local-only (non-serverBacked) process card', () => {
    renderCard(makeProcess({ serverBacked: false }));
    expect(screen.queryByRole('button', { name: /share process/i })).toBeNull();
  });

  it('clicking share opens the members modal for the selected process', async () => {
    renderCard(makeProcess());
    fireEvent.click(screen.getByRole('button', { name: /share process/i }));
    expect(await screen.findByRole('heading', { name: /members/i })).toBeInTheDocument();
  });

  it('opened modal exposes scoped access options (smoke)', async () => {
    renderCard(makeProcess());
    fireEvent.click(screen.getByRole('button', { name: /share process/i }));
    expect(await screen.findByLabelText(/all access/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scoped/i)).toBeInTheDocument();
  });
});
