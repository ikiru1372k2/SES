import type { FunctionId } from '@ses/domain';
import { FUNCTION_REGISTRY, getFunctionLabel } from '@ses/domain';

export type SlaFilter = 'all' | 'ok' | 'due_soon' | 'breached';

export function EscalationFilters({
  stages,
  selectedStages,
  onToggleStage,
  engine,
  onEngine,
  sla,
  onSla,
  assignedToMe,
  onAssignedToMe,
}: {
  stages: string[];
  selectedStages: Set<string>;
  onToggleStage: (stage: string) => void;
  engine: FunctionId | '';
  onEngine: (v: FunctionId | '') => void;
  sla: SlaFilter;
  onSla: (v: SlaFilter) => void;
  assignedToMe: boolean;
  onAssignedToMe: (v: boolean) => void;
}) {
  return (
    <aside className="w-56 shrink-0 space-y-4 border-r border-gray-200 pr-4 dark:border-gray-800">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Stage</div>
        <div className="space-y-1">
          {stages.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedStages.has(s)}
                onChange={() => onToggleStage(s)}
              />
              <span className="truncate">{s}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Engine</div>
        <select
          value={engine}
          onChange={(e) => onEngine((e.target.value as FunctionId) || '')}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        >
          <option value="">All engines</option>
          {FUNCTION_REGISTRY.map((fn) => (
            <option key={fn.id} value={fn.id}>{getFunctionLabel(fn.id as FunctionId)}</option>
          ))}
        </select>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">SLA</div>
        <select
          value={sla}
          onChange={(e) => onSla(e.target.value as SlaFilter)}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        >
          <option value="all">All</option>
          <option value="ok">OK</option>
          <option value="due_soon">Due soon</option>
          <option value="breached">Breached</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={assignedToMe} onChange={(e) => onAssignedToMe(e.target.checked)} />
        Assigned to me
      </label>
      <div className="rounded border border-dashed border-gray-200 p-2 text-xs text-gray-400 dark:border-gray-700">
        Saved views (coming soon)
      </div>
    </aside>
  );
}
