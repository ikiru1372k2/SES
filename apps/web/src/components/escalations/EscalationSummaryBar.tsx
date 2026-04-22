import type { FunctionId, ProcessEscalationsSummary } from '@ses/domain';
import { FUNCTION_REGISTRY, getFunctionLabel } from '@ses/domain';

export function EscalationSummaryBar({ summary }: { summary: ProcessEscalationsSummary }) {
  return (
    <div className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-900 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">Open findings</div>
        <div className="text-2xl font-semibold text-gray-900 dark:text-white">{summary.totalOpenFindings}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">Managers with open</div>
        <div className="text-2xl font-semibold text-gray-900 dark:text-white">{summary.managersWithOpenCount}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">Engines with open</div>
        <div className="text-2xl font-semibold text-gray-900 dark:text-white">{summary.engineCountWithOpen}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500">SLA breaching</div>
        <div className="text-2xl font-semibold text-red-600">{summary.slaBreachingCount}</div>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">Per engine (issues)</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {FUNCTION_REGISTRY.map((fn) => {
            const id = fn.id as FunctionId;
            const c = summary.perEngineIssueCounts[id] ?? 0;
            return (
              <span key={id} className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">
                {getFunctionLabel(id)}: <span className="font-semibold">{c}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
