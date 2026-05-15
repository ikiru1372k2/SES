import { isFunctionId, type FunctionId } from '@ses/domain';
import { effortAnomalies } from '../../lib/domain/anomaly';
import { managerStats } from '../../lib/domain/managerAnalytics';
import type { AuditProcess } from '../../lib/domain/types';
import { EmptyState } from '../shared/EmptyState';
import { AnalyticsWorkbench } from '../analytics/AnalyticsWorkbench';

export function AnalyticsTab({
  process,
  functionId,
}: {
  process: AuditProcess;
  functionId?: string | undefined;
}) {
  const fid: FunctionId | undefined =
    functionId && isFunctionId(functionId) ? (functionId as FunctionId) : undefined;
  const processCode = process.displayCode ?? process.id;

  if (!processCode) {
    return <EmptyState title="Loading…">Process is still loading.</EmptyState>;
  }

  const workbench = (
    <AnalyticsWorkbench processCode={processCode} {...(fid !== undefined ? { functionId: fid } : {})} />
  );

  // Two compact extras the API doesn't yet expose: effort anomalies and
  // manager-performance. These read from already-loaded process state so
  // they cost nothing extra. The main analytics live in the Workbench above.
  const hasVersions = process.versions.length > 0;
  const anomalies = hasVersions ? effortAnomalies(process.versions) : [];
  const stats = hasVersions ? managerStats(process) : [];
  const chronicCount = stats.filter((item) => item.chronicSlowResponder).length;

  return (
    <div className="space-y-5">
      {workbench}

      {hasVersions && (anomalies.length > 0 || stats.length > 0) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {anomalies.length > 0 ? (
            <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h3 className="font-semibold">Effort anomalies</h3>
              <p className="mt-1 text-xs text-gray-500">Projects whose effort changed by 200h or more vs the previous saved version.</p>
              <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">
                {anomalies.slice(0, 6).map((item) => (
                  <li key={item.issue.id} className="py-2 text-sm">
                    <strong>{item.issue.projectNo}</strong> {item.issue.projectName}:{' '}
                    {item.previousEffort}h → {item.issue.effort}h{' '}
                    <span className={item.delta > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                      ({item.delta > 0 ? '+' : ''}{item.delta}h)
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {stats.length > 0 ? (
            <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h3 className="font-semibold">Manager performance</h3>
              <p className="mt-1 text-xs text-gray-500">
                {chronicCount} chronic slow responder(s) across the current cycle.
              </p>
              <table className="mt-3 min-w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="p-2">Manager</th>
                    <th className="p-2">Response</th>
                    <th className="p-2">Avg days</th>
                    <th className="p-2">Last contact</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.slice(0, 8).map((item) => (
                    <tr key={item.email} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="p-2">
                        {item.name}
                        {item.chronicSlowResponder ? (
                          <span className="ml-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                            chronic
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2">{Math.round(item.responseRate * 100)}%</td>
                      <td className="p-2">{item.averageResolutionDays ? `${item.averageResolutionDays.toFixed(1)}d` : '—'}</td>
                      <td className="p-2 text-xs text-gray-500">
                        {item.lastContactAt ? new Date(item.lastContactAt).toLocaleDateString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
