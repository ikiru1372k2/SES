import { FUNCTION_REGISTRY, type FunctionId } from '@ses/domain';
import type { ScopeAccessLevel } from '../../lib/api/membersApi';

const ACCESS_LEVELS: ScopeAccessLevel[] = ['viewer', 'editor'];
const ESCALATION_KEY = '__escalation-center__';
const ALL_FUNCTIONS_KEY = '__all-functions__';

type ScopeKey = FunctionId | typeof ESCALATION_KEY | typeof ALL_FUNCTIONS_KEY;

export interface ScopeEditorState {
  selected: Record<ScopeKey, ScopeAccessLevel | undefined>;
}

export function emptyScopeState(): ScopeEditorState {
  return { selected: {} as Record<ScopeKey, ScopeAccessLevel | undefined> };
}

export { ESCALATION_KEY, ALL_FUNCTIONS_KEY };
export type { ScopeKey };

function ScopeRow({
  label,
  checked,
  level,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  level: ScopeAccessLevel | undefined;
  onChange: (next: ScopeAccessLevel | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 py-0.5 ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked ? level ?? 'viewer' : undefined)}
      />
      <span className="flex-1">{label}</span>
      <select
        value={level ?? 'viewer'}
        disabled={disabled || !checked}
        onChange={(e) => onChange(e.target.value as ScopeAccessLevel)}
        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] dark:border-gray-700 dark:bg-gray-900"
      >
        {ACCESS_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ScopeEditor({
  state,
  onChange,
  disabled = false,
}: {
  state: ScopeEditorState;
  onChange: (next: ScopeEditorState) => void;
  disabled?: boolean;
}) {
  const allOn = !!state.selected[ALL_FUNCTIONS_KEY];

  function toggle(key: ScopeKey, level: ScopeAccessLevel | undefined) {
    const next: ScopeEditorState = { selected: { ...state.selected } };
    if (level === undefined) {
      delete next.selected[key];
    } else {
      next.selected[key] = level;
    }
    onChange(next);
  }

  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-700 dark:bg-gray-800/40">
      <ScopeRow
        label="All functions"
        checked={allOn}
        level={state.selected[ALL_FUNCTIONS_KEY]}
        onChange={(lvl) => toggle(ALL_FUNCTIONS_KEY, lvl)}
        disabled={disabled}
      />
      <div className="ml-2 border-l border-dashed border-gray-300 pl-2 dark:border-gray-700">
        {allOn ? (
          <p className="py-1 text-[11px] italic text-gray-500">
            &quot;All functions&quot; supersedes the per-function selections below.
          </p>
        ) : null}
        {FUNCTION_REGISTRY.map((fn) => (
          <ScopeRow
            key={fn.id}
            label={fn.label}
            checked={!!state.selected[fn.id as FunctionId]}
            level={state.selected[fn.id as FunctionId]}
            onChange={(lvl) => toggle(fn.id as FunctionId, lvl)}
            disabled={disabled || allOn}
          />
        ))}
      </div>
      <ScopeRow
        label="Escalation Center"
        checked={!!state.selected[ESCALATION_KEY]}
        level={state.selected[ESCALATION_KEY]}
        onChange={(lvl) => toggle(ESCALATION_KEY, lvl)}
        disabled={disabled}
      />
    </div>
  );
}
