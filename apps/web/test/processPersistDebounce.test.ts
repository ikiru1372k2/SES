import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuditProcess, AuditVersion, WorkbookFile } from '../src/lib/types';

const { saveProcessesToLocalDb } = vi.hoisted(() => ({
  saveProcessesToLocalDb: vi.fn(),
}));

vi.mock('../src/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/storage')>();
  return {
    ...actual,
    loadProcessesFromLocalDb: vi.fn(() => Promise.resolve([])),
    saveProcessesToLocalDb,
  };
});

import { useAppStore } from '../src/store/useAppStore';

describe('process list persist debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveProcessesToLocalDb.mockClear();
    useAppStore.getState().resetWorkspaceAfterUserSwitch();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('coalesces rapid process updates before writing local DB', async () => {
    expect(useAppStore.getState().processes.length).toBe(0);

    const proc: AuditProcess = {
      id: 'p-debounce',
      name: 'A',
      description: '',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      nextAuditDue: null,
      files: [] as WorkbookFile[],
      activeFileId: null,
      versions: [] as AuditVersion[],
      auditPolicy: {
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
      },
      notificationTracking: {},
      comments: {},
      corrections: {},
      acknowledgments: {},
      savedTemplates: {},
    };

    useAppStore.setState({ processes: [proc] });
    vi.advanceTimersByTime(100);
    useAppStore.setState({ processes: [{ ...proc, name: 'B' }] });
    vi.advanceTimersByTime(100);
    useAppStore.setState({ processes: [{ ...proc, name: 'C' }] });
    vi.advanceTimersByTime(500);
    await vi.runOnlyPendingTimersAsync();

    expect(saveProcessesToLocalDb.mock.calls.length).toBeGreaterThanOrEqual(1);
    const lastArg = saveProcessesToLocalDb.mock.calls.at(-1)?.[0] as AuditProcess[];
    expect(lastArg?.[0]?.name).toBe('C');
  });
});
