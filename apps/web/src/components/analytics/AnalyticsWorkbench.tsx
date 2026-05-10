import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import type { FunctionId } from '@ses/domain';
import {
  fetchAnalyticsAnomalies,
  fetchAnalyticsManagers,
  fetchAnalyticsSummary,
  fetchAnalyticsTimeseries,
} from '../../lib/api/analyticsApi';
import { MetricCard } from '../shared/MetricCard';
import { ChatPane } from './ChatPane';
import { DashboardChartCard } from './DashboardChartCard';
import { OllamaHealthPill } from './OllamaHealthPill';

interface Props {
  processCode: string;
  functionId?: FunctionId;
}

export function AnalyticsWorkbench({ processCode, functionId }: Props) {
  const [versionRef, setVersionRef] = useState<string | undefined>(undefined);
  const [compareTo, setCompareTo] = useState<string | undefined>(undefined);

  const summary = useQuery({
    queryKey: ['analytics-summary', processCode, functionId ?? 'process'],
    queryFn: () => fetchAnalyticsSummary(processCode, functionId),
  });
  const timeseries = useQuery({
    queryKey: ['analytics-timeseries', processCode, functionId ?? 'process'],
    queryFn: () => fetchAnalyticsTimeseries(processCode, functionId),
  });
  const managers = useQuery({
    queryKey: ['analytics-managers', processCode, functionId ?? 'process'],
    queryFn: () => fetchAnalyticsManagers(processCode, functionId),
  });
  const anomalies = useQuery({
    queryKey: ['analytics-anomalies', processCode, functionId ?? 'process'],
    queryFn: () => fetchAnalyticsAnomalies(processCode, functionId),
  });

  const trendData = useMemo(() => {
    const points = timeseries.data ?? [];
    if (functionId) {
      return points.map((p) => ({ version: `V${p.versionNumber}`, flagged: p.flaggedRows, scanned: p.scannedRows }));
    }
    // process-level: one series per function, x=version display code
    const byVersion = new Map<string, Record<string, unknown>>();
    for (const p of points) {
      const key = p.displayCode;
      const slot = byVersion.get(key) ?? { version: key };
      (slot as Record<string, unknown>)[String(p.functionId)] = p.flaggedRows;
      byVersion.set(key, slot);
    }
    return Array.from(byVersion.values());
  }, [timeseries.data, functionId]);

  const versionOptions = useMemo(() => (timeseries.data ?? []).map((v) => v.displayCode), [timeseries.data]);

  const managersChartData = useMemo(
    () => (managers.data ?? []).slice(0, 10).map((m) => ({ manager: m.manager, count: m.count, high: m.high })),
    [managers.data],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="lg:col-span-4">
        {/* Sticky shell. Inner ChatPane has its own scroll container so the
            chat history scrolls independently of the dashboard column. */}
        <div className="lg:sticky lg:top-4 h-[calc(100vh-3rem)] min-h-[520px]">
          <ChatPane
            processCode={processCode}
            {...(functionId !== undefined ? { functionId } : {})}
            {...(versionRef !== undefined ? { versionRef } : {})}
            {...(compareTo !== undefined ? { compareTo } : {})}
          />
        </div>
      </div>

      <div className="space-y-4 lg:col-span-8">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Version</span>
          <select
            value={versionRef ?? ''}
            onChange={(e) => setVersionRef(e.target.value || undefined)}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
          >
            <option value="">Latest</option>
            {versionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <span className="text-xs text-gray-400">vs</span>
          <select
            value={compareTo ?? ''}
            onChange={(e) => setCompareTo(e.target.value || undefined)}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
          >
            <option value="">No compare</option>
            {versionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <a
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900"
              href={`/api/v1/analytics/processes/${encodeURIComponent(processCode)}/export.xlsx${functionId ? `?functionId=${encodeURIComponent(functionId)}` : ''}`}
            >
              Export Excel
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900"
            >
              Print / PDF
            </button>
            <OllamaHealthPill />
          </div>
        </div>

        {summary.data ? (
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Functions covered" value={summary.data.functionsCovered} />
            <MetricCard label="Total scanned" value={summary.data.totalScanned} />
            <MetricCard label="Total flagged" value={summary.data.totalFlagged} />
            <MetricCard
              label="Stale functions"
              value={summary.data.perFunction.filter((p) => p.stale).length}
            />
          </div>
        ) : null}

        {!functionId && summary.data ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 font-semibold">Per-function status</h3>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="p-2">Function</th>
                  <th className="p-2">Scanned</th>
                  <th className="p-2">Flagged</th>
                  <th className="p-2">Last run</th>
                  <th className="p-2">Stale?</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.perFunction.map((p) => (
                  <tr key={p.functionId} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="p-2">{p.label}</td>
                    <td className="p-2">{p.scannedRows}</td>
                    <td className="p-2">{p.flaggedRows}</td>
                    <td className="p-2 text-xs text-gray-500">
                      {p.completedAt ? `${new Date(p.completedAt).toLocaleDateString()} (${p.ageDays}d ago)` : '—'}
                    </td>
                    <td className="p-2">
                      {!p.present ? <span className="text-gray-400">No data</span>
                       : p.stale ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"><Clock size={10}/> Stale</span>
                       : <span className="text-emerald-600">Fresh</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {trendData.length ? (
          <DashboardChartCard
            title={functionId ? 'Issues over versions' : 'Flagged rows over versions (per function)'}
            description="Pick bar / line / area / table from the dropdown."
            data={trendData}
            x="version"
            y={
              functionId
                ? ['flagged', 'scanned']
                : Array.from(new Set((timeseries.data ?? []).map((p) => String(p.functionId))))
            }
            defaultType="line"
            source={{ row_count: trendData.length, dataset_version: 'live' }}
          />
        ) : null}

        {managersChartData.length ? (
          <DashboardChartCard
            title="Top managers by issue count"
            description="Switch between bar, pie, and table to see the same data differently."
            data={managersChartData}
            x="manager"
            y={['count', 'high']}
            pieKey="manager"
            pieValue="count"
            defaultType="bar"
            source={{ row_count: managersChartData.length, dataset_version: 'live' }}
          />
        ) : null}

        {anomalies.data && anomalies.data.ruleViolations.length ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} className="text-rose-600" /> Rule violations
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">{anomalies.data.ruleViolations.length}</span>
            </h3>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {anomalies.data.ruleViolations.slice(0, 25).map((a, i) => (
                <li key={i} className="py-2 text-sm">
                  <span className="font-mono text-xs text-gray-500">{a.functionId} · {a.ruleId ?? '—'}</span>
                  {' '}<strong>{a.projectNo}</strong> {a.projectName} —{' '}
                  <span className="text-gray-600 dark:text-gray-400">{a.reason ?? '(no reason)'}</span>{' '}
                  <span className="text-xs text-gray-500">{a.managerName ?? 'Unassigned'}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
