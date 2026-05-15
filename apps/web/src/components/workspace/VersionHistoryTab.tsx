import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FunctionId } from '@ses/domain';
import { versionComparePath } from '../../lib/processRoutes';
import { compareResults, exportIssuesCsv } from '../../lib/domain/auditEngine';
import { createFileVersionOnApi } from '../../lib/api/fileVersionsApi';
import { downloadFileToDisk } from '../../lib/api/filesApi';
import { downloadAuditedWorkbook } from '../../lib/workbook/excelParser';
import type { AuditProcess, WorkbookFile } from '../../lib/domain/types';
import { selectCorrectionCount } from '../../store/selectors';
import { useAppStore } from '../../store/useAppStore';
import { usePrompt } from '../shared/ConfirmProvider';
import { EmptyState } from '../shared/EmptyState';
import { MetricCard } from '../shared/MetricCard';

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
  const prompt = usePrompt();
  const [fromId, setFromId] = useState(process.versions[1]?.versionId ?? process.versions[0]?.versionId ?? '');
  const [toId, setToId] = useState(process.versions[0]?.versionId ?? '');
  const [activeTab, setActiveTab] = useState<'newIssues' | 'resolvedIssues' | 'changedIssues'>('newIssues');
  const correctionCount = selectCorrectionCount(process);
  const comparison = useMemo(() => {
    const from = process.versions.find((version) => version.id === fromId || version.versionId === fromId);
    const to = process.versions.find((version) => version.id === toId || version.versionId === toId);
    return from && to ? compareResults(from.result, to.result) : null;
  }, [process.versions, fromId, toId]);

  const rows = comparison?.[activeTab] ?? [];
  return (
    <div className="space-y-5">
      {file ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">File Versions</h2>
              <p className="mt-1 text-xs text-gray-500">Source workbook snapshots are separate from saved audit versions.</p>
            </div>
            <button
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
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
            >
              Save file version
            </button>
          </div>
          <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-700 dark:border-gray-700">
            {(file.fileVersions ?? []).map((version) => (
              <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium">V{version.versionNumber}{version.isCurrent ? ' · Current' : ''}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {new Date(version.createdAt).toLocaleString()} · {formatBytes(version.sizeBytes)}
                    {version.note ? ` · ${version.note}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => void downloadFileToDisk(file.displayCode ?? file.id, file.name, version.versionNumber)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700"
                >
                  Download
                </button>
              </div>
            ))}
            {!(file.fileVersions ?? []).length ? <div className="p-3 text-sm text-gray-500">No file versions loaded.</div> : null}
          </div>
        </section>
      ) : null}
      {!process.versions.length ? (
        <EmptyState title="No saved audit versions">Run an audit and save a version to preserve traceability, compare changes, and support notifications.</EmptyState>
      ) : null}
      {process.versions.length ? (
        <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Audit Version History</h2>
        {process.versions.length >= 2 ? (
          <Link
            to={versionComparePath(process.id, functionId)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:border-brand hover:text-brand dark:border-gray-700"
          >
            Open compare page
          </Link>
        ) : null}
      </div>
      <div className="space-y-2">
        {process.versions.map((version) => (
          <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="min-w-0">
              <div className="font-semibold">{version.versionName || `Version ${version.versionNumber}`}</div>
              <div className="mt-1 text-xs text-gray-500">
                {version.versionId} - V{version.versionNumber} - {new Date(version.createdAt).toLocaleString()} - {version.result.flaggedRows} flagged - {version.result.issues.length} issues
              </div>
              {version.notes ? <div className="mt-2 max-w-2xl text-xs text-gray-600 dark:text-gray-300">{version.notes}</div> : null}
            </div>
            <div className="flex gap-2">
              <button onClick={() => loadVersion(process.id, version.versionId)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700">Load this version</button>
              <button onClick={() => { if (file) void downloadAuditedWorkbook(file, version.result); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700">Download</button>
              {correctionCount ? <button onClick={() => { if (file) void downloadAuditedWorkbook(file, version.result, process.corrections); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700">Corrected</button> : null}
            </div>
          </div>
        ))}
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h3 className="font-semibold">Compare versions within this process</h3>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select value={fromId} onChange={(event) => setFromId(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
            {process.versions.map((version) => <option key={version.id} value={version.versionId}>{versionLabel(version)}</option>)}
          </select>
          <span>-&gt;</span>
          <select value={toId} onChange={(event) => setToId(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
            {process.versions.map((version) => <option key={version.id} value={version.versionId}>{versionLabel(version)}</option>)}
          </select>
        </div>
        {comparison ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <MetricCard label="New" value={comparison.newIssues.length} />
              <MetricCard label="Resolved" value={comparison.resolvedIssues.length} />
              <MetricCard label="Changed" value={comparison.changedIssues.length} />
              <MetricCard label="Unchanged" value={comparison.unchangedIssues.length} />
            </div>
            <div className="mt-4 flex gap-2">
              {(['newIssues', 'resolvedIssues', 'changedIssues'] as const).map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`border-b-2 px-3 py-2 text-sm ${activeTab === tab ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}>{tab}</button>)}
              <button onClick={() => exportIssuesCsv('version-comparison.csv', rows)} className="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Export CSV</button>
            </div>
            <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-700 dark:border-gray-700">
              {rows.map((issue) => <div key={issue.id} className="p-3 text-sm"><strong>{issue.projectNo}</strong> - {issue.projectName} - {issue.severity} - {issue.notes}</div>)}
              {!rows.length ? <div className="p-3 text-sm text-gray-500">No records in this group.</div> : null}
            </div>
          </>
        ) : null}
      </section>
        </>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function versionLabel(version: AuditProcess['versions'][number]) {
  const date = new Date(version.createdAt).toLocaleDateString();
  return `${version.versionName || `Version ${version.versionNumber}`} - ${date} - ${version.result.issues.length} issues`;
}
