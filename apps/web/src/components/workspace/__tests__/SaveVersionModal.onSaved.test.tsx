import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AuditProcess } from '../../../lib/domain/types';
import { SaveVersionModal } from '../SaveVersionModal';

// Mock the whole store to avoid pulling in network modules. We only need
// saveVersion + a few setters to exercise the save path.
vi.mock('../../../store/useAppStore', () => {
  const saveVersion = vi.fn(() => ({
    id: 'p1',
    versions: [{ versionName: 'V1' }],
  }));
  const updateProcess = vi.fn(async () => {});
  const setWorkspaceTab = vi.fn();
  const currentAuditResult = { issues: [], runAt: '', fileId: 'f1', scannedRows: 0, flaggedRows: 0, sheets: [] };
  const state = { saveVersion, updateProcess, setWorkspaceTab, currentAuditResult };
  return {
    useAppStore: <T,>(selector: (s: typeof state) => T) => selector(state),
  };
});

// react-hot-toast is a no-op in this test — swallow the imports.
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

function mkProcess(): AuditProcess {
  return {
    id: 'p1',
    name: 'Demo',
    description: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextAuditDue: null,
    files: [],
    activeFileId: null,
    versions: [],
    auditPolicy: {
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
    },
    notificationTracking: {},
    comments: {},
    corrections: {},
    acknowledgments: {},
    savedTemplates: {},
  };
}

describe('SaveVersionModal callback contract (bug #2 — blocker race)', () => {
  let process: AuditProcess;
  beforeEach(() => {
    process = mkProcess();
  });

  it('fires onSaved BEFORE onClose when the form submits successfully', () => {
    const order: string[] = [];
    const onSaved = vi.fn(() => order.push('saved'));
    const onClose = vi.fn(() => order.push('closed'));

    const { container } = render(
      <SaveVersionModal process={process} onClose={onClose} onSaved={onSaved} />,
    );

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['saved', 'closed']);
  });

  it('does NOT fire onSaved when the user clicks Cancel', () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(<SaveVersionModal process={process} onClose={onClose} onSaved={onSaved} />);

    // The Cancel button is variant="secondary" with text "Cancel".
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still works when no onSaved prop is supplied (back-compat)', () => {
    const onClose = vi.fn();
    const { container } = render(<SaveVersionModal process={process} onClose={onClose} />);
    const form = container.querySelector('form');
    fireEvent.submit(form!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
