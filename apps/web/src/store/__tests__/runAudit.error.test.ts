import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditProcess, AuditPolicy, SheetInfo, WorkbookFile } from '../../lib/domain/types';
import { useAppStore } from '../useAppStore';

// Keep the test purely at the store level — no API paths exercised. The
// throw-on-no-sheets branch fires BEFORE any runAuditOnApi / runAuditAsync
// call, so we don't need to mock them; we just need a process whose file
// has zero selected sheets.

function minimalPolicy(): AuditPolicy {
  return {
    highEffortThreshold: 100,
    mediumEffortMin: 0,
    mediumEffortMax: 0,
    lowEffortMin: 0,
    lowEffortMax: 0,
    lowEffortEnabled: false,
    zeroEffortEnabled: true,
    missingEffortEnabled: true,
    missingManagerEnabled: true,
    inPlanningEffortEnabled: true,
    onHoldEffortEnabled: true,
    onHoldEffortThreshold: 0,
    updatedAt: new Date().toISOString(),
  };
}

function sheet(name: string, isSelected: boolean): SheetInfo {
  return {
    name,
    status: 'valid',
    rowCount: 10,
    isSelected,
  };
}

function file(id: string, sheets: SheetInfo[]): WorkbookFile {
  return {
    id,
    name: `${id}.xlsx`,
    uploadedAt: new Date().toISOString(),
    lastAuditedAt: null,
    isAudited: false,
    sheets,
    rawData: {},
  };
}

function process(id: string, files: WorkbookFile[]): AuditProcess {
  return {
    id,
    name: `Process ${id}`,
    description: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextAuditDue: null,
    files,
    activeFileId: files[0]?.id ?? null,
    versions: [],
    auditPolicy: minimalPolicy(),
    notificationTracking: {},
    comments: {},
    corrections: {},
    acknowledgments: {},
    savedTemplates: {},
  };
}

describe('useAppStore.runAudit — no-sheets-selected throw (bug #1)', () => {
  beforeEach(() => {
    // Reset the store's processes slice so tests don't bleed.
    useAppStore.setState({ processes: [] });
  });

  it('throws a user-surfaceable error when no sheets are selected', async () => {
    const f = file('f1', [sheet('Sheet1', false), sheet('Sheet2', false)]);
    const p = process('p1', [f]);
    useAppStore.setState({ processes: [p] });

    await expect(useAppStore.getState().runAudit('p1', 'f1')).rejects.toThrow(/No sheets selected/i);
  });

  it('does not flip isAuditRunning when the no-sheets throw fires', async () => {
    const f = file('f1', [sheet('Sheet1', false)]);
    const p = process('p1', [f]);
    useAppStore.setState({ processes: [p], isAuditRunning: false });

    await expect(useAppStore.getState().runAudit('p1', 'f1')).rejects.toThrow();
    // The flag must stay false — this guarded the "stuck disabled button" regression.
    expect(useAppStore.getState().isAuditRunning).toBe(false);
  });

  it('stays silent (no throw) when the process or file no longer exists', async () => {
    useAppStore.setState({ processes: [] });
    // Resource-vanished path is intentionally silent — button-gating should
    // have blocked it; if it reaches here, there is nothing to audit.
    await expect(useAppStore.getState().runAudit('missing', 'missing')).resolves.toBeUndefined();
  });
});

// Guard: double-check nothing in the assertion path pulled in react-hot-toast
// side-effects. (We import useAppStore which imports toast — but only as a
// reference; never called in the throw path.)
describe('runAudit throw path — no hidden side effects', () => {
  it('does not call any API module in the no-sheets path', async () => {
    // If a future refactor accidentally moves API calls above the guard, this
    // test would catch it — vi.mock intercepts happen at module load, so we
    // rely on the throw occurring synchronously before any fetch runs.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('fetch should not be called in the no-sheets path'),
    );
    const f = file('f1', [sheet('Sheet1', false)]);
    useAppStore.setState({ processes: [process('p1', [f])] });
    await expect(useAppStore.getState().runAudit('p1', 'f1')).rejects.toThrow(/No sheets selected/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
