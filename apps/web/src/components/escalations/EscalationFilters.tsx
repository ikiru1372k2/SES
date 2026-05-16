import type { FunctionId } from '@ses/domain';
import { FUNCTION_REGISTRY, getFunctionLabel } from '@ses/domain';
import { Check } from 'lucide-react';

export type SlaFilter = 'all' | 'ok' | 'due_soon' | 'breached';

const SLA_OPTIONS: { value: SlaFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'breached', label: 'Breached' },
  { value: 'due_soon', label: 'Due soon · 48h' },
  { value: 'ok', label: 'OK' },
];

function CheckRow({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60">
      <input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} />
      <span
        className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border transition-colors ${
          checked
            ? 'border-brand bg-brand text-white'
            : 'border-rule bg-white dark:border-gray-600 dark:bg-gray-900'
        }`}
        aria-hidden="true"
      >
        {checked ? <Check size={10} strokeWidth={3} /> : null}
      </span>
      <span className={`truncate ${checked ? 'font-medium text-brand' : 'text-ink-2 dark:text-gray-300'}`}>
        {label}
      </span>
    </label>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function EscalationFilters({
  stages,
  selectedStages,
  onToggleStage,
  selectedEngines,
  onToggleEngine,
  sla,
  onSla,
  assignedToMe,
  onAssignedToMe,
}: {
  stages: string[];
  selectedStages: Set<string>;
  onToggleStage: (stage: string) => void;
  selectedEngines: Set<FunctionId>;
  onToggleEngine: (engine: FunctionId) => void;
  sla: SlaFilter;
  onSla: (v: SlaFilter) => void;
  assignedToMe: boolean;
  onAssignedToMe: (v: boolean) => void;
}) {
  return (
    <aside className="w-full shrink-0 space-y-5 rounded-xl border border-rule bg-white p-4 shadow-soft md:w-56 dark:border-gray-800 dark:bg-gray-900">
      <FilterGroup label="Engine">
        {FUNCTION_REGISTRY.map((fn) => (
          <CheckRow
            key={fn.id}
            checked={selectedEngines.has(fn.id as FunctionId)}
            label={getFunctionLabel(fn.id as FunctionId)}
            onToggle={() => onToggleEngine(fn.id as FunctionId)}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="SLA">
        {SLA_OPTIONS.map((opt) => (
          <CheckRow
            key={opt.value}
            checked={sla === opt.value || (opt.value === 'all' && sla === 'all')}
            label={opt.label}
            onToggle={() => onSla(opt.value)}
          />
        ))}
      </FilterGroup>

      {stages.length > 0 ? (
        <FilterGroup label="Stage">
          {stages.map((s) => (
            <CheckRow
              key={s}
              checked={selectedStages.has(s)}
              label={s}
              onToggle={() => onToggleStage(s)}
            />
          ))}
        </FilterGroup>
      ) : null}

      <FilterGroup label="Assignment">
        <CheckRow
          checked={assignedToMe}
          label="Assigned to me"
          onToggle={() => onAssignedToMe(!assignedToMe)}
        />
      </FilterGroup>
    </aside>
  );
}
