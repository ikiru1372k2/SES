import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Clock } from 'lucide-react';
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
import { PinnedWorkbench } from './PinnedWorkbench';

interface Props {
  processCode: string;
  functionId?: FunctionId;
}

export function AnalyticsWorkbench({ processCode, functionId }: Props) {
  const [versionRef, setVersionRef] = useState<string | undefined>(undefined);
  const [compareTo, setCompareTo] = useState<string | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);

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
    <div className="space-y-4">
      {/* Reference two-pane: conversational chat (left) + pinned workbench
          (right, primary). Equal-height columns; each pane scrolls inside. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="h-[calc(100vh-12rem)] min-h-[520px]">
            <ChatPane
              processCode={processCode}
              {...(functionId !== undefined ? { functionId } : {})}
              {...(versionRef !== undefined ? { versionRef } : {})}
              {...(compareTo !== undefined ? { compareTo } : {})}
            />
          </div>
        </div>

        <div className="lg:col-span-7 xl:col-span-8">
          <div className="h-[calc(100vh-12rem)] min-h-[520px]">
            <PinnedWorkbench processCode={processCode} />
          </div>
        </div>
      </div>

      {/* Everything that used to be the analytics dashboard is preserved here,
          collapsed by default so the workbench is the primary surface. */}
      <section className="surface-card overflow-hidden">
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
          aria-expanded={detailOpen}
        >
          <span className="text-[13px] font-bold text-ink dark:text-white">
            Detailed analytics
          </span>
          <span className="chip chip-plain">summary · trends · anomalies</span>
          <span className="flex-1" />
          <OllamaHealthPill />
          <ChevronDown
            size={16}
            className={`text-ink-3 transition-transform ${detailOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {detailOpen ? (
          <div className="space-y-4 border-t border-rule p-4 dark:border-gray-800">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rule bg-surface-2 p-3 dark:border-gray-800">
              <span className="eyebrow">Version</span>
              <select
                value={versionRef ?? ''}
                onChange={(e) => setVersionRef(e.target.value || undefined)}
                className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
              >
                <option value="">Latest</option>
                {versionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <span className="text-xs text-ink-3">vs</span>
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
              <section className="rounded-xl border border-rule bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="mb-3 font-semibold">Per-function status</h3>
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800">
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
                      <tr key={p.functionId} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="p-2">{p.label}</td>
                        <td className="p-2">{p.scannedRows}</td>
                        <td className="p-2">{p.flaggedRows}</td>
                        <td className="p-2 text-xs text-ink-3">
                          {p.completedAt ? `${new Date(p.completedAt).toLocaleDateString()} (${p.ageDays}d ago)` : '—'}
                        </td>
                        <td className="p-2">
                          {!p.present ? <span className="text-ink-3">No data</span>
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
              <section className="rounded-xl border border-rule bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="mb-3 flex items-center gap-2 font-semibold">
                  <AlertTriangle size={16} className="text-brand" /> Rule violations
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">{anomalies.data.ruleViolations.length}</span>
                </h3>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {anomalies.data.ruleViolations.slice(0, 25).map((a, i) => (
                    <li key={i} className="py-2 text-sm">
                      <span className="font-mono text-xs text-ink-3">{a.functionId} · {a.ruleId ?? '—'}</span>
                      {' '}<strong>{a.projectNo}</strong> {a.projectName} —{' '}
                      <span className="text-ink-2 dark:text-gray-400">{a.reason ?? '(no reason)'}</span>{' '}
                      <span className="text-xs text-ink-3">{a.managerName ?? 'Unassigned'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
