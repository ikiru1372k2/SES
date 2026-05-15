import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { FUNCTION_REGISTRY } from '@ses/domain';
import { ProcessTiles } from '../ProcessTiles';
import type { AuditProcess, AuditVersion, WorkbookFile } from '../../lib/domain/types';

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

const mockProcess: AuditProcess = {
  id: 'p-tiles',
  displayCode: 'PRC-TILES',
  name: 'Tile test process',
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
};

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

describe('ProcessTiles', () => {
  it('shows file counts from the tiles API response', () => {
    const tiles = FUNCTION_REGISTRY.reduce(
      (acc, fn) => {
        acc[fn.id] = {
          fileCount: fn.id === 'over-planning' ? 9 : 0,
          lastUploadAt: null,
          hasDraft: false,
        };
        return acc;
      },
      {} as Record<string, { fileCount: number; lastUploadAt: null; hasDraft: boolean }>,
    );

    vi.mocked(rq.useQuery).mockReturnValue({
      data: tiles,
      isError: false,
      error: null,
      isPending: false,
      isFetching: false,
    } as never);

    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({
        processes: [mockProcess],
        hydrateProcesses: vi.fn().mockResolvedValue(undefined),
      } as never),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/processes/p-tiles']}>
          <Routes>
            <Route path="/processes/:processId" element={<ProcessTiles />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const overTile = document.querySelector('[data-function-id="over-planning"]');
    expect(overTile?.textContent).toContain('9');
  });
});
