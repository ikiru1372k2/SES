import { describe, expect, it, vi } from 'vitest';
import { handleEnvelope } from '../useRealtime';
import { useAppStore } from '../../store/useAppStore';

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

describe('handleEnvelope', () => {
  it('forces a latest-result refresh for the file mentioned by audit.completed', () => {
    const hydrateLatestAuditResult = vi.fn();
    vi.mocked(useAppStore.getState).mockReturnValue({
      processes: [
        {
          id: 'process-1',
          displayCode: 'PRC-1',
          files: [{ id: 'file-1', displayCode: 'FIL-1' }],
          activeFileId: 'file-1',
        },
      ],
      hydrateLatestAuditResult,
    } as never);

    handleEnvelope(
      {
        event: 'audit.completed',
        processCode: 'PRC-1',
        payload: { runCode: 'RUN-1', fileCode: 'FIL-1' },
        actor: { code: 'USR-2', displayName: 'Other User' },
      } as never,
      'USR-1',
      vi.fn(),
      vi.fn(),
      { current: undefined },
    );

    expect(hydrateLatestAuditResult).toHaveBeenCalledWith('process-1', 'file-1', { force: true });
  });
});
