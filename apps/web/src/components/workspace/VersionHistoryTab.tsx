import { useNavigate } from 'react-router-dom';
import type { AuditIssue, FunctionId } from '@ses/domain';
import { workspacePath } from '../../lib/processRoutes';
import { createFileVersionOnApi } from '../../lib/api/fileVersionsApi';
import { downloadFileToDisk } from '../../lib/api/filesApi';
import { downloadAuditedWorkbook } from '../../lib/workbook/excelParser';
import type { AuditProcess, WorkbookFile } from '../../lib/domain/types';
import { selectCorrectionCount } from '../../store/selectors';
import { useAppStore } from '../../store/useAppStore';
import { usePrompt } from '../shared/ConfirmProvider';
import { VersionCompareView } from '../version-compare/VersionCompareView';

export function VersionHistoryTab({
  process,
  file,
  functionId,
}: {
  process: AuditProcess;
  file?: WorkbookFile | undefined;
  functionId: FunctionId;
}) {
  const loadVersion = useAppStore((state) => state.loadVersion);
  const hydrateFunctionWorkspace = useAppStore((state) => state.hydrateFunctionWorkspace);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);
  const navigate = useNavigate();
  const prompt = usePrompt();
  const correctionCount = selectCorrectionCount(process);

  const openIssue = (issue: AuditIssue) => {
    const key = issue.issueKey ?? issue.id;
    if (!key) return;
    setWorkspaceTab('results');
    const path = workspacePath(process.displayCode ?? process.id, functionId);
    void navigate(`${path}?tab=results&issue=${encodeURIComponent(key)}`);
  };

  return (
    <div className="space-y-8 p-5 sm:p-6">
      <VersionCompareView
        process={process}
        activeFileId={file?.id}
        onOpenIssue={openIssue}
        showTitle
      />

      {file ? (
        <section className="rounded-xl border border-rule bg-white p-4 shadow-soft dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink dark:text-white">File versions</h2>
              <p className="mt-1 text-xs text-ink-3">
                Source workbook snapshots are separate from saved audit versions.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const note = await prompt({
                  title: 'Save source file version',
                  description: 'Optional note for this snapshot of the raw workbook.',
                  placeholder: 'e.g. Pre-month-end freeze',
                  multiline: true,
                  confirmLabel: 'Save file version',
                });
                if (note === null) return;
                await createFileVersionOnApi(file.displayCode ?? file.id, note);
                await hydrateFunctionWorkspace(process.id, (file.functionId ?? 'master-data') as FunctionId);
              }}
              className="rounded-lg border border-rule px-3 py-2 text-sm text-ink-2 hover:bg-surface-app dark:border-gray-700"
            >
              Save file version
            </button>
          </div>
          <div className="mt-3 divide-y divide-rule-2 rounded-lg border border-rule-2 dark:divide-gray-800 dark:border-gray-800">
            {(file.fileVersions ?? []).map((version) => (
              <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium text-ink dark:text-white">
                    V{version.versionNumber}
                    {version.isCurrent ? ' · Current' : ''}
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {new Date(version.createdAt).toLocaleString()} · {formatBytes(version.sizeBytes)}
                    {version.note ? ` · ${version.note}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadFileToDisk(file.displayCode ?? file.id, file.name, version.versionNumber)}
                  className="rounded-lg border border-rule px-3 py-1.5 text-xs hover:bg-surface-app dark:border-gray-700"
                >
                  Download
                </button>
              </div>
            ))}
            {!(file.fileVersions ?? []).length ? (
              <div className="p-3 text-sm text-ink-3">No file versions loaded.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {process.versions.length > 0 ? (
        <section>
          <h2 className="text-base font-semibold text-ink dark:text-white">Saved audit versions</h2>
          <p className="mt-1 text-xs text-ink-3">Load a version into the workspace or download its audited workbook.</p>
          <div className="mt-3 space-y-2">
            {process.versions.map((version) => (
              <div
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-white p-4 text-sm shadow-soft dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-ink dark:text-white">
                    {version.versionName || `Version ${version.versionNumber}`}
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {new Date(version.createdAt).toLocaleString()} · {version.result.flaggedRows} flagged ·{' '}
                    {version.result.issues.length} issues
                  </div>
                  {version.notes ? (
                    <div className="mt-2 max-w-2xl text-xs text-ink-2">{version.notes}</div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => loadVersion(process.id, version.versionId)}
                    className="rounded-lg border border-rule px-3 py-1.5 text-xs hover:bg-surface-app dark:border-gray-700"
                  >
                    Load this version
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (file) void downloadAuditedWorkbook(file, version.result);
                    }}
                    disabled={!file}
                    className="rounded-lg border border-rule px-3 py-1.5 text-xs hover:bg-surface-app disabled:opacity-40 dark:border-gray-700"
                  >
                    Download
                  </button>
                  {correctionCount && file ? (
                    <button
                      type="button"
                      onClick={() => void downloadAuditedWorkbook(file, version.result, process.corrections)}
                      className="rounded-lg border border-rule px-3 py-1.5 text-xs hover:bg-surface-app dark:border-gray-700"
                    >
                      Corrected
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
