import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AuditProcess } from '../../lib/types';
import { EmptyState } from '../shared/EmptyState';
import { MetricCard } from '../shared/MetricCard';

export function AnalyticsTab({ process }: { process: AuditProcess }) {
  if (!process.versions.length) return <EmptyState title="No analytics yet">Save versions to build trends for flagged rows, issues, and manager risk.</EmptyState>;
  const latest = process.versions[0].result;
  const trend = [...process.versions].reverse().map((version) => ({ version: `V${version.versionNumber}`, flagged: version.result.flaggedRows, issues: version.result.issues.length }));
  const managerRows = Object.entries(latest.issues.reduce<Record<string, number>>((acc, issue) => ({ ...acc, [issue.projectManager]: (acc[issue.projectManager] ?? 0) + 1 }), {})).map(([manager, count]) => ({ manager, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  const high = latest.issues.filter((issue) => issue.severity === 'High').length;
  const medium = latest.issues.filter((issue) => issue.severity === 'Medium').length;
  const low = latest.issues.filter((issue) => issue.severity === 'Low').length;
  const total = Math.max(1, high + medium + low);

  return (
    <div className="space-y-5">
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
    </div>
  );
}
