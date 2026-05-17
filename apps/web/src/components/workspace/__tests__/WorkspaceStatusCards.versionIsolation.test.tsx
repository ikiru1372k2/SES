import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuditProcess, AuditResult, AuditVersion } from '../../../lib/domain/types';
import { selectFunctionVersions } from '../../../lib/domain/versionScope';
import { WorkspaceStatusCards } from '../WorkspaceStatusCards';

function mkResult(fileId: string): AuditResult {
  return { fileId, runAt: '', scannedRows: 0, flaggedRows: 0, issues: [], sheets: [] };
}
function mkVersion(id: string, n: number, fileId: string, fnId: string): AuditVersion {
  return {
    id,
    versionId: id,
    versionNumber: n,
    versionName: `${fnId} V${n}`,
    notes: '',
    createdAt: new Date(2026, 0, n).toISOString(),
    result: mkResult(fileId),
    functionId: fnId,
  };
}

// Full process: master-data at v2 (head of the global array) + function-rate v1.
const fullProcess = {
  id: 'p1',
  name: 'Demo',
  files: [
    { id: 'f-md', functionId: 'master-data' },
    { id: 'f-fr', functionId: 'function-rate' },
  ],
  versions: [
    mkVersion('mdv2', 2, 'f-md', 'master-data'),
    mkVersion('frv1', 1, 'f-fr', 'function-rate'),
    mkVersion('mdv1', 1, 'f-md', 'master-data'),
  ],
} as unknown as AuditProcess;

describe('WorkspaceStatusCards — version pills are per function', () => {
  it('shows the active function head, never another function’s version', () => {
    // Workspace passes a function-scoped process; emulate that for function-rate.
    const scoped = {
      ...fullProcess,
      versions: selectFunctionVersions(fullProcess, 'function-rate'),
    } as AuditProcess;

    render(
      <WorkspaceStatusCards
        activeFile={undefined}
        sessionResult={null}
        process={scoped}
        onSaveAsNew={() => {}}
      />,
    );

    // Function Rate's own V1 is the head (name + " (head)" share one span).
    expect(screen.getByText(/function-rate V1\s*\(head\)/)).toBeTruthy();
    // Master Data's v2/v1 must not leak into Function Rate's card.
    expect(screen.queryByText(/master-data V2/)).toBeNull();
    expect(screen.queryByText(/master-data V1/)).toBeNull();
  });
});
