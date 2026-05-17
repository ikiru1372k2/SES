import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { EscalationPanel } from '../EscalationPanel';

function row(p: Partial<ProcessEscalationManagerRow> = {}): ProcessEscalationManagerRow {
  return {
    managerKey: 'kumar-arjun',
    managerName: 'Kumar, Arjun',
    resolvedEmail: 'arjun.kumar@demo.com',
    directoryEmail: null,
    directoryTeamsUsername: null,
    isUnmapped: false,
    totalIssues: 3,
    countsByEngine: { 'master-data': 3 },
    findingsByEngine: {},
    stage: 'ESCALATED_L1',
    resolved: false,
    lastContactAt: null,
    lastActivityAt: null,
    slaDueAt: null,
    trackingId: 'trk-1',
    trackingDisplayCode: 'TRK-1',
    outlookCount: 2,
    teamsCount: 1,
    ...p,
  };
}

function renderPanel(panelRow: ProcessEscalationManagerRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EscalationPanel
          processId="process-1"
          processDisplayCode="PRC-1"
          row={panelRow}
          open
          onClose={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EscalationPanel', () => {
  it('marks an escalated row resolved through the stage transition API', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ stage: 'RESOLVED', resolved: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPanel(row());

    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/tracking/trk-1/transition',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            to: 'RESOLVED',
            reason: 'manager_resolution_confirmed',
            sourceAction: 'panel.mark_resolved',
          }),
        }),
      );
    });
  });

  it('shows auditor verification after a row is resolved but unverified', () => {
    renderPanel(row({ stage: 'RESOLVED', resolved: true, verifiedAt: null }));

    expect(screen.getByRole('button', { name: /verified/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark resolved/i })).not.toBeInTheDocument();
  });
});
