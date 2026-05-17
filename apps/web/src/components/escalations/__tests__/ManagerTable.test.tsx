import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { ManagerTable } from '../ManagerTable';

function row(p: Partial<ProcessEscalationManagerRow> & Pick<ProcessEscalationManagerRow, 'managerKey' | 'managerName'>): ProcessEscalationManagerRow {
  return {
    resolvedEmail: null,
    directoryEmail: null,
    directoryTeamsUsername: null,
    isUnmapped: false,
    totalIssues: 1,
    countsByEngine: {},
    findingsByEngine: {},
    stage: null,
    resolved: false,
    lastContactAt: null,
    slaDueAt: null,
    trackingId: null,
    trackingDisplayCode: null,
    ...p,
  };
}

describe('ManagerTable', () => {
  it('invokes onSortKey when a sort header is clicked', () => {
    const onSortKey = vi.fn();
    const rows = [
      row({ managerKey: 'a', managerName: 'Ann', totalIssues: 2 }),
      row({ managerKey: 'b', managerName: 'Ben', totalIssues: 1 }),
    ];

    render(
      <ManagerTable
        now={0}
        rows={rows}
        selectedTrackingIds={new Set()}
        onToggleTracking={vi.fn()}
        onToggleAllVisible={vi.fn()}
        selectedManagerKey={null}
        onSelectManagerKey={vi.fn()}
        onOpenPanel={vi.fn()}
        sortKey="issues"
        onSortKey={onSortKey}
        onEngineFromPill={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    expect(onSortKey).toHaveBeenCalledWith('stage');
  });

  it('requests selection changes with j and k (by manager key)', () => {
    const onSelectManagerKey = vi.fn();
    const rows = [
      row({ managerKey: 'a', managerName: 'Ann', totalIssues: 2 }),
      row({ managerKey: 'b', managerName: 'Ben', totalIssues: 1 }),
    ];

    render(
      <ManagerTable
        now={0}
        rows={rows}
        selectedTrackingIds={new Set()}
        onToggleTracking={vi.fn()}
        onToggleAllVisible={vi.fn()}
        selectedManagerKey="a"
        onSelectManagerKey={onSelectManagerKey}
        onOpenPanel={vi.fn()}
        sortKey="issues"
        onSortKey={vi.fn()}
        onEngineFromPill={vi.fn()}
      />,
    );

    // Sorted by issues desc: [Ann (2), Ben (1)]. Starting at key "a", j → "b", then k → "a".
    fireEvent.keyDown(window, { key: 'j' });
    expect(onSelectManagerKey).toHaveBeenCalledWith('b');
    onSelectManagerKey.mockClear();
    fireEvent.keyDown(window, { key: 'k' });
    expect(onSelectManagerKey).toHaveBeenCalledWith('a');
  });

  it('opens the panel for the selected manager key on Enter', () => {
    const onOpenPanel = vi.fn();
    const rows = [
      row({ managerKey: 'a', managerName: 'Ann', totalIssues: 2 }),
      row({ managerKey: 'b', managerName: 'Ben', totalIssues: 1 }),
    ];

    render(
      <ManagerTable
        now={0}
        rows={rows}
        selectedTrackingIds={new Set()}
        onToggleTracking={vi.fn()}
        onToggleAllVisible={vi.fn()}
        selectedManagerKey="b"
        onSelectManagerKey={vi.fn()}
        onOpenPanel={onOpenPanel}
        sortKey="issues"
        onSortKey={vi.fn()}
        onEngineFromPill={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenPanel).toHaveBeenCalledWith(rows[1]);
  });

  it('uses directory email fallback for mapped rows without issue email', () => {
    render(
      <ManagerTable
        now={0}
        rows={[
          row({
            managerKey: 'missing-email:de-vries-lisa',
            managerName: 'De Vries, Lisa',
            directoryEmail: 'devries@email.com',
            totalIssues: 4,
            stage: 'NEW',
          }),
        ]}
        selectedTrackingIds={new Set()}
        onToggleTracking={vi.fn()}
        onToggleAllVisible={vi.fn()}
        selectedManagerKey={null}
        onSelectManagerKey={vi.fn()}
        onOpenPanel={vi.fn()}
        sortKey="priority"
        onSortKey={vi.fn()}
        onEngineFromPill={vi.fn()}
      />,
    );

    expect(screen.getByText('devries@email.com')).toBeInTheDocument();
    expect(screen.queryByText(/missing email/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open/i })).toBeInTheDocument();
  });

  it('highlights resolved rows in green', () => {
    const { container } = render(
      <ManagerTable
        now={0}
        rows={[
          row({ managerKey: 'done', managerName: 'Taylor Resolved', resolved: true, stage: 'RESOLVED' }),
          row({ managerKey: 'still', managerName: 'River Active' }),
        ]}
        selectedTrackingIds={new Set()}
        onToggleTracking={vi.fn()}
        onToggleAllVisible={vi.fn()}
        selectedManagerKey={null}
        onSelectManagerKey={vi.fn()}
        onOpenPanel={vi.fn()}
        sortKey="priority"
        onSortKey={vi.fn()}
        onEngineFromPill={vi.fn()}
      />,
    );

    const rowsEls = container.querySelectorAll('tbody tr');
    const resolvedRow = Array.from(rowsEls).find((tr) => tr.textContent?.includes('Taylor Resolved'));
    const openRow = Array.from(rowsEls).find((tr) => tr.textContent?.includes('River Active'));
    expect(resolvedRow?.className).toContain('bg-green-50');
    expect(openRow?.className).not.toContain('bg-green-50');
  });
});
