import type { FunctionId, ProcessEscalationsSummary } from '@ses/domain';
import { FUNCTION_REGISTRY, getFunctionLabel } from '@ses/domain';
import { Badge } from '../shared/Badge';

export function EscalationSummaryBar({ summary }: { summary: ProcessEscalationsSummary }) {
  return (
    <div className="mb-4 grid gap-4 rounded-xl border border-rule bg-white p-4 text-sm shadow-soft dark:border-gray-800 dark:bg-gray-900 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <div className="eyebrow">Open findings</div>
        <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-ink dark:text-white">
          {summary.totalOpenFindings}
        </div>
      </div>
      <div>
        <div className="eyebrow">Managers with open</div>
        <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-ink dark:text-white">
          {summary.managersWithOpenCount}
        </div>
      </div>
      <div>
        <div className="eyebrow">Engines with open</div>
        <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-ink dark:text-white">
          {summary.engineCountWithOpen}
        </div>
      </div>
      <div>
        <div className="eyebrow">SLA breaching</div>
        <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-danger-700">
          {summary.slaBreachingCount}
        </div>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="eyebrow">Per engine (issues)</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {FUNCTION_REGISTRY.map((fn) => {
            const id = fn.id as FunctionId;
            const c = summary.perEngineIssueCounts[id] ?? 0;
            return (
              <Badge key={id} tone="gray">
                {getFunctionLabel(id)}: <span className="font-semibold">{c}</span>
              </Badge>
            );
          })}
        </div>
      </div>
    </div>
  );
}
