import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { ManagerTable } from '../ManagerTable';

function row(p: Partial<ProcessEscalationManagerRow> & Pick<ProcessEscalationManagerRow, 'managerKey' | 'managerName'>): ProcessEscalationManagerRow {
  return {
    resolvedEmail: null,
    directoryEmail: null,
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
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onOpenPanel={vi.fn()}
        sortKey="issues"
        onSortKey={onSortKey}
        engineFilter=""
        onEngineFromPill={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    expect(onSortKey).toHaveBeenCalledWith('stage');
  });

  it('requests selection changes with j and k', () => {
    const onSelectIndex = vi.fn();
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
        selectedIndex={0}
        onSelectIndex={onSelectIndex}
        onOpenPanel={vi.fn()}
        sortKey="issues"
        onSortKey={vi.fn()}
        engineFilter=""
        onEngineFromPill={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'j' });
    expect(onSelectIndex).toHaveBeenCalledWith(1);

    fireEvent.keyDown(window, { key: 'k' });
    expect(onSelectIndex).toHaveBeenCalledWith(0);
  });

  it('opens the panel for the row at selectedIndex on Enter', () => {
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
        selectedIndex={1}
        onSelectIndex={vi.fn()}
        onOpenPanel={onOpenPanel}
        sortKey="issues"
        onSortKey={vi.fn()}
        engineFilter=""
        onEngineFromPill={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenPanel).toHaveBeenCalledWith(rows[1]);
  });
});
