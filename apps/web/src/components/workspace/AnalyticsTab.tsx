import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { isFunctionId, type FunctionId } from '@ses/domain';
import { effortAnomalies } from '../../lib/anomaly';
import { managerStats } from '../../lib/managerAnalytics';
import type { AuditProcess } from '../../lib/types';
import { EmptyState } from '../shared/EmptyState';
import { MetricCard } from '../shared/MetricCard';
import { AnalyticsWorkbench } from '../analytics/AnalyticsWorkbench';

export function AnalyticsTab({
  process,
  functionId,
}: {
  process: AuditProcess;
  functionId?: string | undefined;
}) {
  const fid: FunctionId | undefined = functionId && isFunctionId(functionId) ? (functionId as FunctionId) : undefined;
  const processCode = process.displayCode ?? process.id;
  const workbench = processCode ? (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-1 dark:border-rose-900 dark:bg-rose-950/20">
      <AnalyticsWorkbench processCode={processCode} {...(fid !== undefined ? { functionId: fid } : {})} />
    </section>
  ) : null;

  if (!process.versions.length) {
    return (
      <div className="space-y-4">
        {workbench}
        <EmptyState title="No saved versions yet">Save a version to unlock the legacy charts below.</EmptyState>
      </div>
    );
  }
  const latest = process.versions[0]!.result;
  const trend = [...process.versions].reverse().map((version) => ({ version: `V${version.versionNumber}`, flagged: version.result.flaggedRows, issues: version.result.issues.length }));
  const managerRows = Object.entries(latest.issues.reduce<Record<string, number>>((acc, issue) => ({ ...acc, [issue.projectManager]: (acc[issue.projectManager] ?? 0) + 1 }), {})).map(([manager, count]) => ({ manager, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  const high = latest.issues.filter((issue) => issue.severity === 'High').length;
  const medium = latest.issues.filter((issue) => issue.severity === 'Medium').length;
  const low = latest.issues.filter((issue) => issue.severity === 'Low').length;
  const total = Math.max(1, high + medium + low);
  const anomalies = effortAnomalies(process.versions);
  const stats = managerStats(process);
  const chronicCount = stats.filter((item) => item.chronicSlowResponder).length;

  return (
    <div className="space-y-5">
      {workbench}
      <h2 className="mt-2 border-t border-gray-100 pt-4 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800">
        Legacy version-based widgets
      </h2>
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Files" value={process.files.length} />
        <MetricCard label="Versions" value={process.versions.length} />
        <MetricCard label="Latest Flagged" value={latest.flaggedRows} />
        <MetricCard label="Open Follow-ups" value={new Set(latest.issues.map((issue) => issue.projectManager)).size} />
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Severity Distribution</h2>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"><div className="bg-red-500" style={{ width: `${(high / total) * 100}%` }} /><div className="bg-amber-500" style={{ width: `${(medium / total) * 100}%` }} /><div className="bg-blue-500" style={{ width: `${(low / total) * 100}%` }} /></div>
        <p className="mt-2 text-sm text-gray-500">High {high} · Medium {medium} · Low {low}</p>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Issue Trend</h2>
        <div className="mt-4 h-72"><ResponsiveContainer><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="version" /><YAxis /><Tooltip /><Line dataKey="flagged" stroke="#2563eb" /><Line dataKey="issues" stroke="#dc2626" /></LineChart></ResponsiveContainer></div>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Top Managers by Flagged Rows</h2>
        <div className="mt-4 h-72"><ResponsiveContainer><BarChart data={managerRows} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="manager" type="category" width={120} /><Tooltip /><Bar dataKey="count" fill="#2563eb" /></BarChart></ResponsiveContainer></div>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Effort Anomalies</h2>
        <p className="mt-1 text-sm text-gray-500">Projects whose effort changed by 200h or more versus the previous saved version.</p>
        <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-700 dark:border-gray-700">
          {anomalies.map((item) => (
            <div key={item.issue.id} className="p-3 text-sm">
              <strong>{item.issue.projectNo}</strong> - {item.issue.projectName}: {item.previousEffort}h to {item.issue.effort}h ({item.delta > 0 ? '+' : ''}{item.delta}h)
            </div>
          ))}
          {!anomalies.length ? <div className="p-3 text-sm text-gray-500">No effort anomalies detected.</div> : null}
        </div>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Manager performance</h2>
        <p className="mt-1 text-sm text-gray-500">
          {chronicCount} chronic slow responder(s) across the current cycle.
        </p>
        <table className="mt-4 min-w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr><th scope="col" className="p-3">Manager</th><th scope="col">Response rate</th><th scope="col">Avg resolution</th><th scope="col">Last contact</th><th scope="col" aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {stats.map((item) => (
              <tr key={item.email} className="border-t border-gray-100 dark:border-gray-700">
                <td className="p-3">{item.name}</td>
                <td>{Math.round(item.responseRate * 100)}%</td>
                <td>{item.averageResolutionDays ? `${item.averageResolutionDays.toFixed(1)}d` : '-'}</td>
                <td>{item.lastContactAt ? new Date(item.lastContactAt).toLocaleDateString() : 'Never'}</td>
                <td>{item.chronicSlowResponder ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300">Chronic</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
