import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FunctionTile } from '../FunctionTile';

const baseStats = { fileCount: 2, lastUploadAt: null, hasDraft: true };

function renderTile(headVersionLabel: string | null) {
  const { container } = render(
    <FunctionTile
      functionId="master-data"
      label="Master Data"
      stats={baseStats}
      openEscalationCount={3}
      headVersionLabel={headVersionLabel}
      onOpen={vi.fn()}
    />,
  );
  // Scope to the 3-up stats grid so the footer "Open" button doesn't
  // collide with the "Open" stat label.
  return container.querySelector('.grid-cols-3') as HTMLElement;
}

function statText(grid: HTMLElement, label: string): string {
  return (within(grid).getByText(label).parentElement?.textContent ?? '');
}

describe('FunctionTile — Version stat replaces Drafts', () => {
  it('shows the head version label and no Drafts stat', () => {
    const grid = renderTile('v1');
    expect(within(grid).getByText('Version')).toBeTruthy();
    expect(screen.queryByText('Drafts')).toBeNull();
    expect(statText(grid, 'Version')).toContain('v1');
    expect(statText(grid, 'Files')).toContain('2');
    expect(statText(grid, 'Open')).toContain('3');
  });

  it('shows an em dash when the function has no saved version', () => {
    const grid = renderTile(null);
    expect(within(grid).getByText('Version')).toBeTruthy();
    expect(statText(grid, 'Version')).toContain('—');
    expect(screen.queryByText('Drafts')).toBeNull();
  });

  it('renders even with no stats (Files 0, Version —)', () => {
    const { container } = render(
      <FunctionTile
        functionId="over-planning"
        label="Over Planning"
        stats={undefined}
        openEscalationCount={0}
        headVersionLabel={null}
        onOpen={vi.fn()}
      />,
    );
    const grid = container.querySelector('.grid-cols-3') as HTMLElement;
    expect(statText(grid, 'Files')).toContain('0');
    expect(statText(grid, 'Version')).toContain('—');
  });
});
