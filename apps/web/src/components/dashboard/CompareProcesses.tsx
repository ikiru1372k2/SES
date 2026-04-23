import { useMemo, useState } from 'react';
import { compareResults, exportIssuesCsv } from '../../lib/auditEngine';
import type { AuditVersion, ComparisonResult } from '../../lib/types';
import { displayName } from '../../lib/storage';
import { useAppStore } from '../../store/useAppStore';
import { AppShell } from '../layout/AppShell';
import { usePageHeader } from '../layout/usePageHeader';
import { EmptyState } from '../shared/EmptyState';
import { MetricCard } from '../shared/MetricCard';

export function CompareProcesses() {
  const processes = useAppStore((state) => state.processes);
  const [fromProcessId, setFromProcessId] = useState(processes[0]?.id ?? '');
  const [toProcessId, setToProcessId] = useState(processes[1]?.id ?? processes[0]?.id ?? '');
  const fromProcess = processes.find((process) => process.id === fromProcessId);
  const toProcess = processes.find((process) => process.id === toProcessId);
  const [fromVersionId, setFromVersionId] = useState(fromProcess?.versions[0]?.versionId ?? '');
  const [toVersionId, setToVersionId] = useState(toProcess?.versions[0]?.versionId ?? '');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [tab, setTab] = useState<keyof ComparisonResult>('newIssues');

  const versionOptions = useMemo(() => ({ from: fromProcess?.versions ?? [], to: toProcess?.versions ?? [] }), [fromProcess, toProcess]);

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: 'Compare' },
      ],
    }),
    [],
  );
  usePageHeader(headerConfig);

  function compare() {
    const fromVersion = versionOptions.from.find((version) => version.id === fromVersionId || version.versionId === fromVersionId) ?? versionOptions.from[0];
    const toVersion = versionOptions.to.find((version) => version.id === toVersionId || version.versionId === toVersionId) ?? versionOptions.to[0];
    if (fromVersion && toVersion) setResult(compareResults(fromVersion.result, toVersion.result));
  }

  function selectVersion(versions: AuditVersion[], id: string, fallback: (id: string) => void) {
    fallback(id || versions[0]?.versionId || versions[0]?.id || '');
  }

  if (processes.filter((process) => process.versions.length).length < 1) {
    return (
      <AppShell>
        <div className="p-6">
          <EmptyState title="No saved versions yet">Save at least one audited version before comparing processes.</EmptyState>
        </div>
      </AppShell>
    );
  }

  const rows = result?.[tab] ?? [];
  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <h1 className="text-xl font-semibold">Compare Processes</h1>
        <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800 md:grid-cols-[1fr_auto_1fr]">
          <Selector label="From" processes={processes} processId={fromProcessId} versionId={fromVersionId} onProcess={(id) => { setFromProcessId(id); selectVersion(processes.find((p) => p.id === id)?.versions ?? [], '', setFromVersionId); }} onVersion={setFromVersionId} versions={versionOptions.from} />
          <div className="self-end pb-2 text-gray-400">-&gt;</div>
          <Selector label="To" processes={processes} processId={toProcessId} versionId={toVersionId} onProcess={(id) => { setToProcessId(id); selectVersion(processes.find((p) => p.id === id)?.versions ?? [], '', setToVersionId); }} onVersion={setToVersionId} versions={versionOptions.to} />
          <div className="md:col-span-3">
            <button onClick={compare} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">Compare Selected Versions</button>
          </div>
        </div>
        {result ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="New" value={result.newIssues.length} />
              <MetricCard label="Resolved" value={result.resolvedIssues.length} />
              <MetricCard label="Changed" value={result.changedIssues.length} />
              <MetricCard label="Unchanged" value={result.unchangedIssues.length} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['newIssues', 'resolvedIssues', 'changedIssues', 'managerChanges', 'effortChanges'] as const).map((item) => (
                <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === item ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{item.replace(/([A-Z])/g, ' $1')}</button>
              ))}
              <button onClick={() => exportIssuesCsv('process-comparison.csv', rows)} className="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Export CSV</button>
              <button onClick={() => downloadJson(result)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Export JSON</button>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              {rows.length ? rows.map((issue) => <div key={issue.id} className="border-b border-gray-100 p-4 text-sm last:border-0 dark:border-gray-700"><strong>{issue.projectNo}</strong> - {issue.projectName} - {issue.severity} - {issue.notes}</div>) : <div className="p-5 text-sm text-gray-500">No differences in this tab.</div>}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function Selector({ label, processes, processId, versionId, versions, onProcess, onVersion }: { label: string; processes: ReturnType<typeof useAppStore.getState>['processes']; processId: string; versionId: string; versions: AuditVersion[]; onProcess: (id: string) => void; onVersion: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <select value={processId} onChange={(event) => onProcess(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        {processes.map((process) => <option key={process.id} value={process.id}>{displayName(process.name)}</option>)}
      </select>
      <select value={versionId || versions[0]?.versionId || versions[0]?.id || ''} onChange={(event) => onVersion(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        {versions.map((version) => <option key={version.id} value={version.versionId || version.id}>{versionLabel(version)}</option>)}
      </select>
    </div>
  );
}

function versionLabel(version: AuditVersion) {
  const date = new Date(version.createdAt).toLocaleDateString();
  return `${version.versionName || `Version ${version.versionNumber}`} - ${date} - ${version.result.issues.length} issues`;
}

function downloadJson(result: ComparisonResult) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'process-comparison.json';
  link.click();
  URL.revokeObjectURL(url);
}
