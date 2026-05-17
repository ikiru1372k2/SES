import { memo, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpCircle,
  Bot,
  Check,
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { addStageComment, fetchStageComments } from '../../lib/api/trackingStageApi';

/**
 * Activity-tab header: state-machine ladder + SLA + escalation context.
 * Nodes click into an append-only stage-scoped comment thread.
 * All state is derived from ProcessEscalationManagerRow — no new server fields.
 */

type StageKey = string;

interface StageNode {
  key: StageKey;
  label: string;
  shortLabel: string;
  completed: boolean;
  /** Who's responsible for this step? "System" / "Auditor" / manager name. */
  owner: string;
  /** Lucide icon for the node. */
  Icon: typeof Mail;
}

function buildStages(row: ProcessEscalationManagerRow): StageNode[] {
  const outlook = row.outlookCount ?? 0;
  const teams = row.teamsCount ?? 0;
  const stage = row.stage ?? '';
  const responded = stage === 'RESPONDED' || Boolean(row.verifiedAt);
  const verified = Boolean(row.verifiedAt);
  const resolved = row.resolved === true || stage === 'RESOLVED';
  const drafted =
    stage === 'DRAFTED' ||
    stage === 'SENT' ||
    stage === 'AWAITING_RESPONSE' ||
    outlook >= 1 ||
    teams >= 1;

  const nodes: StageNode[] = [
    {
      key: 'DRAFTED',
      label: 'Drafted',
      shortLabel: 'Drafted',
      completed: drafted,
      owner: 'Auditor',
      Icon: Sparkles,
    },
  ];

  const outlookSlots = Math.max(outlook + 1, 1);
  for (let i = 1; i <= outlookSlots; i += 1) {
    nodes.push({
      key: `OUTLOOK_${i}`,
      label: `Outlook #${i}`,
      shortLabel: `Outlook #${i}`,
      completed: outlook >= i,
      owner: 'Auditor',
      Icon: Mail,
    });
  }

  const teamsSlots = Math.max(teams + 1, 1);
  for (let i = 1; i <= teamsSlots; i += 1) {
    nodes.push({
      key: `TEAMS_${i}`,
      label: i === 1 ? 'Teams' : `Teams #${i}`,
      shortLabel: i === 1 ? 'Teams' : `Teams #${i}`,
      completed: teams >= i,
      owner: 'Auditor',
      Icon: MessageSquare,
    });
  }

  nodes.push(
    {
      key: 'RESPONDED',
      label: 'Manager responded',
      shortLabel: 'Manager',
      completed: responded,
      owner: row.managerName || 'Manager',
      Icon: UserIcon,
    },
    {
      key: 'VERIFIED',
      label: 'Auditor verified',
      shortLabel: 'Verified',
      completed: verified,
      owner: row.verifiedByName ?? 'Auditor',
      Icon: ShieldCheck,
    },
    {
      key: 'RESOLVED',
      label: 'Resolved',
      shortLabel: 'Resolved',
      completed: resolved && verified,
      owner: 'Auditor',
      Icon: Check,
    },
  );

  return nodes;
}

function currentNodeIndex(nodes: StageNode[]): number {
  for (let i = 0; i < nodes.length; i += 1) {
    if (!nodes[i]!.completed) return i;
  }
  return nodes.length - 1;
}

interface SlaInfo {
  state: 'breached' | 'at-risk' | 'on-track' | 'none';
  /** Remaining ms (negative when breached). */
  deltaMs: number;
  label: string;
  tooltip: string;
}

function describeSla(slaDueAt: string | null | undefined, now: number): SlaInfo {
  if (!slaDueAt) {
    return { state: 'none', deltaMs: 0, label: 'No SLA set', tooltip: '' };
  }
  const due = new Date(slaDueAt).getTime();
  const delta = due - now;
  const abs = Math.abs(delta);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && (mins || (!hours && !days))) parts.push(`${mins}m`);
  const compact = parts.slice(0, 2).join(' ') || '0m';
  if (delta < 0) {
    return {
      state: 'breached',
      deltaMs: delta,
      label: `SLA breached • ${compact} overdue`,
      tooltip: `SLA was due ${new Date(slaDueAt).toLocaleString()}.`,
    };
  }
  if (delta < 8 * 3_600_000) {
    return {
      state: 'at-risk',
      deltaMs: delta,
      label: `SLA at risk • ${compact} left`,
      tooltip: `SLA due ${new Date(slaDueAt).toLocaleString()}. Closing in soon — escalates to PM if breached.`,
    };
  }
  return {
    state: 'on-track',
    deltaMs: delta,
    label: `${compact} until SLA`,
    tooltip: `SLA due ${new Date(slaDueAt).toLocaleString()}.`,
  };
}

function progressPercent(nodes: StageNode[]): number {
  const done = nodes.filter((n) => n.completed).length;
  return Math.round((done / nodes.length) * 100);
}

interface AutomationTag {
  label: string;
  tone: 'amber' | 'red' | 'blue' | 'gray';
  Icon: typeof Mail;
}

function automationTagsFor(row: ProcessEscalationManagerRow, sla: SlaInfo): AutomationTag[] {
  const tags: AutomationTag[] = [];
  const stage = row.stage ?? '';
  const lvl = row.escalationLevel ?? 0;

  if (sla.state === 'breached') {
    tags.push({ label: 'SLA breached', tone: 'red', Icon: AlertTriangle });
  } else if (sla.state === 'at-risk') {
    tags.push({ label: 'SLA at risk', tone: 'amber', Icon: Clock });
  }
  if (lvl >= 1) {
    tags.push({
      label: `Escalated L${lvl}`,
      tone: lvl >= 2 ? 'red' : 'amber',
      Icon: ArrowUpCircle,
    });
  }
  if (stage === 'AWAITING_RESPONSE' || stage === 'SENT') {
    tags.push({ label: 'Waiting for manager', tone: 'blue', Icon: Clock });
  }
  if (stage === 'NO_RESPONSE') {
    tags.push({ label: 'Blocked — no response', tone: 'red', Icon: AlertTriangle });
  }
  if (row.draftLockExpiresAt) {
    const lockedBy = row.draftLockUserDisplayName ?? 'someone else';
    tags.push({ label: `Locked by ${lockedBy}`, tone: 'gray', Icon: UserIcon });
  }
  return tags;
}

const TONE_BG: Record<AutomationTag['tone'], string> = {
  amber: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900',
  red: 'bg-red-50 text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900',
  blue: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900',
  gray: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700',
};

export const StageGraph = memo(function StageGraph({
  row,
  trackingIdOrCode,
}: {
  row: ProcessEscalationManagerRow;
  trackingIdOrCode: string;
}) {
  const [openStage, setOpenStage] = useState<StageKey | null>(null);
  // Tick once per minute so the SLA countdown updates without server hits.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nodes = useMemo(() => buildStages(row), [row]);
  const current = currentNodeIndex(nodes);
  const sla = useMemo(() => describeSla(row.slaDueAt, now), [row.slaDueAt, now]);
  const tags = useMemo(() => automationTagsFor(row, sla), [row, sla]);
  const progress = useMemo(() => progressPercent(nodes), [nodes]);
  const escalationLevel = row.escalationLevel ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => (
          <span
            key={t.label}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_BG[t.tone]}`}
          >
            <t.Icon size={12} />
            {t.label}
          </span>
        ))}
        <SlaPill info={sla} />
        {escalationLevel >= 1 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
            <ArrowUpCircle size={12} />
            ESCALATED L{escalationLevel}
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-300">
          <span className="relative inline-block h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </span>
          {progress}%
        </span>
      </div>

      <ol className="flex flex-wrap items-stretch gap-1.5">
        {nodes.map((node, index) => {
          const isCurrent = !node.completed && index === current;
          const isEscalated = !node.completed && index === current && escalationLevel >= 1;
          const status: 'done' | 'current' | 'future' | 'escalated' = node.completed
            ? 'done'
            : isEscalated
              ? 'escalated'
              : isCurrent
                ? 'current'
                : 'future';
          return (
            <li key={node.key} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOpenStage(node.key)}
                aria-current={isCurrent ? 'step' : undefined}
                className={[
                  'group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition',
                  status === 'done'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                    : status === 'escalated'
                      ? 'border-red-400 bg-red-50 text-red-800 ring-2 ring-red-300 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
                      : status === 'current'
                        ? 'border-blue-400 bg-blue-50 text-blue-800 ring-2 ring-blue-300 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
                ].join(' ')}
                title={`${node.label} — owner: ${node.owner}\nClick to open notes for this step`}
              >
                <span
                  className={[
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    status === 'done'
                      ? 'bg-emerald-600 text-white'
                      : status === 'escalated'
                        ? 'bg-red-600 text-white'
                        : status === 'current'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                  ].join(' ')}
                >
                  {status === 'done' ? <Check size={11} /> : index + 1}
                </span>
                <node.Icon size={12} className="opacity-70" />
                <span className="font-medium">{node.shortLabel}</span>
                <span className="hidden text-[10px] opacity-70 sm:inline">· {node.owner}</span>
              </button>
              {index < nodes.length - 1 ? (
                <span
                  className={`h-px w-3 ${
                    status === 'done' ? 'bg-emerald-300' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {openStage ? (
        <StageCommentThread
          trackingIdOrCode={trackingIdOrCode}
          stage={openStage}
          stageLabel={nodes.find((n) => n.key === openStage)?.label ?? openStage}
          owner={nodes.find((n) => n.key === openStage)?.owner ?? '—'}
          onClose={() => setOpenStage(null)}
        />
      ) : null}
    </div>
  );
});

function SlaPill({ info }: { info: SlaInfo }) {
  if (info.state === 'none') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
        <Clock size={12} /> No SLA
      </span>
    );
  }
  const cls =
    info.state === 'breached'
      ? 'bg-red-600 text-white shadow-sm animate-pulse'
      : info.state === 'at-risk'
        ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800'
        : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
      title={info.tooltip}
    >
      <Clock size={12} />
      {info.label}
    </span>
  );
}

function StageCommentThread({
  trackingIdOrCode,
  stage,
  stageLabel,
  owner,
  onClose,
}: {
  trackingIdOrCode: string;
  stage: StageKey;
  stageLabel: string;
  owner: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const q = useQuery({
    queryKey: ['tracking-stage-comments', trackingIdOrCode, stage],
    queryFn: () => fetchStageComments(trackingIdOrCode, stage),
  });

  const addMut = useMutation({
    mutationFn: () => addStageComment(trackingIdOrCode, { stage, body: body.trim() }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['tracking-stage-comments', trackingIdOrCode, stage] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-soft dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-white">
            <MessageCircle size={14} />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {stageLabel} notes
            </div>
            <div className="text-[11px] text-gray-500">
              <Bot size={10} className="-mt-0.5 mr-0.5 inline" /> Owner: {owner} · Append-only
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label="Close stage notes"
        >
          <X size={14} />
        </button>
      </header>
      <ul className="mt-3 space-y-2 text-sm">
        {q.isLoading ? <li className="text-xs text-gray-500">Loading…</li> : null}
        {q.data && q.data.length === 0 ? (
          <li className="rounded-lg border border-dashed border-gray-300 px-2 py-4 text-center text-xs text-gray-500 dark:border-gray-700">
            No notes yet — add the first one below.
          </li>
        ) : null}
        {q.data?.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 dark:border-gray-800 dark:bg-gray-900/60"
          >
            <div className="text-[11px] text-gray-500">
              {c.authorName} · {new Date(c.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          addMut.mutate();
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={`Add a note for ${stageLabel}…`}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="submit"
          disabled={addMut.isPending || !body.trim()}
          className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white shadow-soft transition-all ease-soft hover:bg-brand-hover hover:shadow-soft-md active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          Post
        </button>
      </form>
    </div>
  );
}
