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

/**
 * Sentinel "stage" for the auditor-verified state. `verifiedAt` is a flag, not
 * a domain stage, so it can't be a real ESCALATION_STAGES value — the parent
 * detects this key and filters on `stage === RESOLVED && verifiedAt` instead.
 */
export const VERIFIED_STAGE_KEY = '__VERIFIED__';

/**
 * Fixed escalation ladder shown in the Stage filter, in lifecycle order, with
 * clean labels. Always rendered (not derived from current data) so the filter
 * is predictable. Raw values are the canonical ESCALATION_STAGES enum — the
 * backend state machine is unchanged. "Resolved" and "Verified" are distinct:
 * Resolved = stage RESOLVED awaiting verification; Verified = verifiedAt set.
 */
const STAGE_LADDER: { value: string; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'DRAFTED', label: 'Draft prepared' },
  { value: 'SENT', label: 'Sent' },
  { value: 'AWAITING_RESPONSE', label: 'Awaiting reply' },
  { value: 'RESPONDED', label: 'Responded' },
  { value: 'NO_RESPONSE', label: 'No response' },
  { value: 'ESCALATED_L1', label: 'Escalated · L1' },
  { value: 'ESCALATED_L2', label: 'Escalated · L2' },
  { value: 'RESOLVED', label: 'Resolved · awaiting verification' },
  { value: VERIFIED_STAGE_KEY, label: 'Verified' },
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
  selectedStages,
  onToggleStage,
  selectedEngines,
  onToggleEngine,
  sla,
  onSla,
  assignedToMe,
  onAssignedToMe,
}: {
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
    <aside className="flex max-h-[max(560px,calc(100vh-340px))] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-rule bg-white p-4 shadow-soft md:h-full md:max-h-none md:w-56 dark:border-gray-800 dark:bg-gray-900">
      {/* Inner scroll: on md+ the parent caps height, so the filter list
          must scroll within this card instead of spilling out below it. */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto md:-mr-1 md:pr-1">
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

      <FilterGroup label="Stage">
        {STAGE_LADDER.map((s) => (
          <CheckRow
            key={s.value}
            checked={selectedStages.has(s.value)}
            label={s.label}
            onToggle={() => onToggleStage(s.value)}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Assignment">
        <CheckRow
          checked={assignedToMe}
          label="Assigned to me"
          onToggle={() => onAssignedToMe(!assignedToMe)}
        />
      </FilterGroup>
      </div>
    </aside>
  );
}
