import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceShell } from '../WorkspaceShell';

vi.mock('../../../lib/featureFlags', () => ({
  isLegacyTileTrackingTabEnabled: () => false,
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

import { useAppStore } from '../../../store/useAppStore';

describe('WorkspaceShell (tracking tab flag)', () => {
  it('does not list Tracking when legacy tile tracking is disabled', () => {
    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({
        activeWorkspaceTab: 'preview',
        setWorkspaceTab: vi.fn(),
      } as never),
    );

    render(
      <WorkspaceShell>
        <div />
      </WorkspaceShell>,
    );

    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.queryByText('Tracking')).not.toBeInTheDocument();
  });
});
