import type { FunctionId } from '@ses/domain';
import { useMemo } from 'react';
import { useAllRules } from '../../hooks/useAiPilot';
import type { AuditRuleListItem } from '../../lib/api/rulesApi';
import { AiBadge } from './AiBadge';

export function AllRulesPane({ functionId }: { functionId: FunctionId }) {
  const query = useAllRules(functionId);
  const rules = query.data ?? [];

  const sorted = useMemo(() => {
    // AI rules first (newest first), then system rules alphabetical by name.
    const ai = rules
      .filter((r) => r.source === 'ai-pilot')
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const sys = rules
      .filter((r) => r.source !== 'ai-pilot')
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...ai, ...sys];
  }, [rules]);

  return (
    <aside className="flex h-full flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          All rules
        </p>
        <span className="text-[10px] text-gray-400">{rules.length}</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <p className="p-3 text-xs text-gray-500">Loading…</p>
        ) : query.isError ? (
          <p className="p-3 text-xs text-red-600">Could not load rules.</p>
        ) : sorted.length === 0 ? (
          <p className="p-3 text-xs text-gray-500">No rules for this function.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {sorted.map((r) => (
              <RuleRow key={r.ruleCode} rule={r} />
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-500 dark:border-gray-800">
        Read-only. Manage AI rules in the middle pane.
      </footer>
    </aside>
  );
}

function RuleRow({ rule }: { rule: AuditRuleListItem }) {
  const dotColor =
    rule.defaultSeverity === 'High'
      ? 'bg-red-500'
      : rule.defaultSeverity === 'Medium'
        ? 'bg-amber-500'
        : 'bg-gray-400';

  const muted = rule.status === 'archived' || rule.status === 'paused';

  return (
    <li
      className={`px-3 py-2 ${muted ? 'opacity-60' : ''}`}
      title={`${rule.ruleCode}\n${rule.description}`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${dotColor}`}
          aria-label={rule.defaultSeverity}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
              {rule.name}
            </span>
            {rule.source === 'ai-pilot' ? <AiBadge tooltip="Authored via AI Pilot" /> : null}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="font-mono">{rule.ruleCode}</span>
            {rule.status !== 'active' ? <StatusChip status={rule.status} /> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function StatusChip({ status }: { status: 'paused' | 'archived' | 'active' }) {
  const cls =
    status === 'paused'
      ? 'bg-amber-100 text-amber-700'
      : status === 'archived'
        ? 'bg-gray-200 text-gray-600'
        : 'bg-green-100 text-green-700';
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}
