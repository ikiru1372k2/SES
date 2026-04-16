import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { compareResults } from '../lib/auditEngine';
import { useAppStore } from '../store/useAppStore';
import { AppShell } from '../components/layout/AppShell';
import { MetricCard } from '../components/shared/MetricCard';
import { EmptyState } from '../components/shared/EmptyState';

type Bucket = 'newIssues' | 'resolvedIssues' | 'changedIssues' | 'unchangedIssues';

export function VersionCompare() {
  const { id } = useParams();
  const process = useAppStore((state) => state.processes.find((item) => item.id === id));
  const [bucket, setBucket] = useState<Bucket>('newIssues');
  const [fromId, setFromId] = useState(process?.versions[1]?.versionId ?? process?.versions[0]?.versionId ?? '');
  const [toId, setToId] = useState(process?.versions[0]?.versionId ?? '');
  const comparison = useMemo(() => {
    const from = process?.versions.find((version) => version.versionId === fromId || version.id === fromId);
    const to = process?.versions.find((version) => version.versionId === toId || version.id === toId);
    return from && to ? compareResults(from.result, to.result) : null;
  }, [fromId, process?.versions, toId]);

  if (!process) return <Navigate to="/" replace />;
  if (process.versions.length < 2) {
    return (
      <AppShell process={process}>
        <div className="p-5">
          <EmptyState title="Need two saved versions">Save at least two audit versions before comparing.</EmptyState>
        </div>
      </AppShell>
    );
  }

  const rows = comparison?.[bucket] ?? [];
  return (
    <AppShell process={process}>
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to={`/workspace/${process.id}`} className="text-sm text-brand hover:underline">Back to workspace</Link>
            <h1 className="mt-2 text-xl font-semibold">Version Compare</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={fromId} onChange={(event) => setFromId(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
              {process.versions.map((version) => <option key={version.id} value={version.versionId}>{version.versionName}</option>)}
            </select>
            <span className="text-sm text-gray-500">to</span>
            <select value={toId} onChange={(event) => setToId(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
              {process.versions.map((version) => <option key={version.id} value={version.versionId}>{version.versionName}</option>)}
            </select>
          </div>
        </div>
        {comparison ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="New" value={comparison.newIssues.length} />
              <MetricCard label="Resolved" value={comparison.resolvedIssues.length} />
              <MetricCard label="Changed" value={comparison.changedIssues.length} />
              <MetricCard label="Unchanged" value={comparison.unchangedIssues.length} />
            </div>
            <div className="flex flex-wrap gap-2">
              {(['newIssues', 'resolvedIssues', 'changedIssues', 'unchangedIssues'] as const).map((key) => (
                <button key={key} onClick={() => setBucket(key)} className={`rounded-lg border px-3 py-2 text-sm ${bucket === key ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-300 dark:border-gray-700'}`}>{key.replace(/([A-Z])/g, ' $1')}</button>
              ))}
            </div>
            <div className="overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700"><tr><th className="p-3">Project</th><th>Severity</th><th>Manager</th><th>State</th><th>Effort</th><th>Reason</th></tr></thead>
                <tbody>
                  {rows.map((issue) => <tr key={issue.id} className="border-t border-gray-100 dark:border-gray-700"><td className="p-3">{issue.projectNo} - {issue.projectName}</td><td>{issue.severity}</td><td>{issue.projectManager}</td><td>{issue.projectState}</td><td>{issue.effort}</td><td>{issue.reason ?? issue.notes}</td></tr>)}
                </tbody>
              </table>
              {!rows.length ? <div className="p-5 text-sm text-gray-500">No records in this bucket.</div> : null}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
