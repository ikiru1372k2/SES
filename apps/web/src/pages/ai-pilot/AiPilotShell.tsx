import type { FunctionId } from '@ses/domain';
import { FUNCTION_REGISTRY, isFunctionId } from '@ses/domain';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../components/shared/ConfirmProvider';
import { AllRulesPane } from '../../components/ai-pilot/AllRulesPane';
import { SandboxModal } from '../../components/ai-pilot/SandboxModal';
import { useAiHealth, useAiPilotAuditLog, useAiRules, useSetRuleStatus } from '../../hooks/useAiPilot';
import type { AiRuleListItem } from '../../lib/api/aiPilotApi';

const DEFAULT_FN: FunctionId = 'master-data';

export function AiPilotShell() {
  const params = useParams<{ functionId?: string }>();
  const navigate = useNavigate();
  const requested = params.functionId && isFunctionId(params.functionId) ? params.functionId : null;
  const activeFn: FunctionId = requested ?? DEFAULT_FN;
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const health = useAiHealth();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-xs text-gray-500 hover:text-brand"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={14} className="inline" /> Dashboard
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
            <Sparkles size={18} className="text-brand" />
            AI Pilot
          </h1>
          <HealthDot ok={health.data?.ok ?? null} />
        </div>
        <button
          type="button"
          onClick={() => setSandboxOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          <Plus size={14} />
          Author new rule
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 pb-2 dark:border-gray-700">
        {FUNCTION_REGISTRY.map((fn) => {
          const active = fn.id === activeFn;
          return (
            <button
              key={fn.id}
              type="button"
              onClick={() => navigate(`/admin/ai-pilot/${fn.id}`)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                active
                  ? 'bg-brand text-white'
                  : 'border border-gray-200 text-gray-700 hover:border-brand hover:text-brand dark:border-gray-700 dark:text-gray-200'
              }`}
            >
              {fn.label}
            </button>
          );
        })}
      </div>

      <FunctionPane functionId={activeFn} />

      <SandboxModal
        open={sandboxOpen}
        functionId={activeFn}
        onClose={() => setSandboxOpen(false)}
      />
    </div>
  );
}

function HealthDot({ ok }: { ok: boolean | null }) {
  const color =
    ok === null ? 'bg-gray-300' : ok ? 'bg-green-500' : 'bg-red-500';
  const label = ok === null ? 'AI service status unknown' : ok ? 'AI service online' : 'AI service offline';
  return <span title={label} className={`h-2 w-2 rounded-full ${color}`} />;
}

function FunctionPane({ functionId }: { functionId: FunctionId }) {
  const rulesQuery = useAiRules(functionId);
  const [selected, setSelected] = useState<string | null>(null);
  const rules = rulesQuery.data ?? [];
  const selectedRule = useMemo(
    () => rules.find((r) => r.ruleCode === selected) ?? null,
    [rules, selected],
  );

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr_320px]">
      <AllRulesPane functionId={functionId} />
      <AiRulesPane
        rules={rules}
        loading={rulesQuery.isLoading}
        onSelect={setSelected}
        selectedRuleCode={selected}
      />
      <RuleDetailPane rule={selectedRule} />
    </div>
  );
}

function AiRulesPane({
  rules,
  loading,
  selectedRuleCode,
  onSelect,
}: {
  rules: AiRuleListItem[];
  loading: boolean;
  selectedRuleCode: string | null;
  onSelect: (code: string) => void;
}) {
  const setStatus = useSetRuleStatus();
  const confirm = useConfirm();

  if (loading) return <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">Loading…</div>;

  if (rules.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
        <Sparkles size={28} className="mx-auto text-brand" />
        <p className="mt-2 font-medium text-gray-800 dark:text-gray-100">No AI rules yet</p>
        <p className="mt-1 text-xs text-gray-500">
          Click <span className="font-semibold">Author new rule</span> to write one in plain
          English.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800">
          <tr>
            <th className="px-3 py-2">Rule</th>
            <th className="px-3 py-2">Severity</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Authored</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr
              key={r.ruleCode}
              onClick={() => onSelect(r.ruleCode)}
              className={`cursor-pointer border-t border-gray-100 hover:bg-brand-subtle/40 dark:border-gray-800 ${
                selectedRuleCode === r.ruleCode ? 'bg-brand-subtle/60' : ''
              }`}
            >
              <td className="px-3 py-2">
                <div className="font-medium text-gray-900 dark:text-white">{r.name}</div>
                <div className="text-[10px] font-mono text-gray-400">{r.ruleCode}</div>
              </td>
              <td className="px-3 py-2 text-xs">{r.severity}</td>
              <td className="px-3 py-2">
                <StatusChip status={r.status} />
              </td>
              <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                {r.aiMeta?.authoredBy?.displayName ?? '—'}
              </td>
              <td className="px-3 py-2 text-right">
                <RuleActions
                  rule={r}
                  busy={setStatus.isPending}
                  onPause={() =>
                    setStatus.mutate({ ruleCode: r.ruleCode, status: 'paused' })
                  }
                  onResume={() =>
                    setStatus.mutate({ ruleCode: r.ruleCode, status: 'active' })
                  }
                  onArchive={async () => {
                    const ok = await confirm({
                      title: `Archive ${r.name}?`,
                      description: 'Archived rules stop running on new audits. Past escalations remain.',
                      confirmLabel: 'Archive',
                      tone: 'destructive',
                    });
                    if (!ok) return;
                    setStatus.mutate(
                      { ruleCode: r.ruleCode, status: 'archived' },
                      { onSuccess: () => toast.success('Rule archived') },
                    );
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'active'
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
      : status === 'paused'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{status}</span>
  );
}

function RuleActions({
  rule,
  busy,
  onPause,
  onResume,
  onArchive,
}: {
  rule: AiRuleListItem;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5 text-[11px]">
      {rule.status === 'active' ? (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onPause();
          }}
          className="rounded-md border border-gray-300 px-2 py-0.5 hover:border-amber-400 hover:text-amber-700 dark:border-gray-700"
        >
          Pause
        </button>
      ) : null}
      {rule.status === 'paused' ? (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onResume();
          }}
          className="rounded-md border border-gray-300 px-2 py-0.5 hover:border-green-500 hover:text-green-700 dark:border-gray-700"
        >
          Resume
        </button>
      ) : null}
      {rule.status !== 'archived' ? (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          className="rounded-md border border-gray-300 px-2 py-0.5 hover:border-brand hover:text-brand dark:border-gray-700"
        >
          Archive
        </button>
      ) : null}
    </div>
  );
}

function RuleDetailPane({ rule }: { rule: AiRuleListItem | null }) {
  const auditLog = useAiPilotAuditLog(rule?.ruleCode ? { ruleCode: rule.ruleCode, limit: 25 } : { limit: 25 });
  if (!rule) {
    return (
      <aside className="rounded-xl border border-dashed border-gray-300 p-4 text-xs text-gray-500 dark:border-gray-700">
        Select a rule to see its details.
      </aside>
    );
  }
  return (
    <aside className="space-y-3 rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-700">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white">{rule.name}</h3>
        <p className="mt-0.5 text-[10px] font-mono text-gray-400">{rule.ruleCode}</p>
      </div>
      <Detail label="Description">{rule.aiMeta?.description ?? '—'}</Detail>
      <Detail label="Flag message">{rule.aiMeta?.flagMessage ?? '—'}</Detail>
      <Detail label="Severity">{rule.severity}</Detail>
      <Detail label="Category">{rule.category}</Detail>
      <Detail label="Status">
        <StatusChip status={rule.status} />
      </Detail>
      <Detail label="Authored by">{rule.aiMeta?.authoredBy?.displayName ?? '—'}</Detail>
      <Detail label="Logic">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-2 font-mono text-[10px] text-gray-700 dark:bg-gray-800 dark:text-gray-200">
          {JSON.stringify(rule.aiMeta?.logic, null, 2)}
        </pre>
      </Detail>
      <Detail label="Activity">
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-gray-50 p-2 text-[10px] dark:bg-gray-800">
          {auditLog.isLoading ? (
            <li className="text-gray-500">Loading…</li>
          ) : (auditLog.data ?? []).length === 0 ? (
            <li className="text-gray-500">No activity yet.</li>
          ) : (
            (auditLog.data ?? []).map((entry) => (
              <li key={entry.id} className="text-gray-700 dark:text-gray-200">
                <span className="font-medium">{entry.actor?.displayName ?? '—'}</span>{' '}
                <span className="text-gray-500">{entry.action}</span>{' '}
                <span className="text-gray-400">
                  · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))
          )}
        </ul>
      </Detail>
    </aside>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-0.5 text-xs text-gray-700 dark:text-gray-200">{children}</div>
    </div>
  );
}
