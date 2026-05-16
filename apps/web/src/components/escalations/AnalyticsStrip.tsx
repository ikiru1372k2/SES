import { useMemo } from 'react';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { AlertTriangle, CheckCircle2, Clock, Flame, Mail, Users } from 'lucide-react';

interface Props {
  rows: ProcessEscalationManagerRow[];
  /** Caller-supplied "now" in ms — lets the parent drive ticking via a state
   *  update without this component calling the impure `Date.now()` in render. */
  now: number;
}

/**
 * Analytics strip at the top of the Escalation Center. Derives all numbers
 * from already-loaded rows so it's free to render and always in sync.
 */
export function AnalyticsStrip({ rows, now }: Props) {
  const analytics = useMemo(() => {
    const total = rows.length;
    let openFindings = 0;
    let resolvedManagers = 0;
    let breached = 0;
    let dueSoon = 0;
    let missingEmail = 0;
    const topOffender = { name: '', count: 0 };

    for (const row of rows) {
      if (row.resolved) {
        resolvedManagers += 1;
        continue;
      }
      const open = row.totalIssues ?? 0;
      openFindings += open;
      if (open > topOffender.count) {
        topOffender.name = row.managerName ?? 'Unknown';
        topOffender.count = open;
      }
      // Mirror backend's ManagerDirectory fallback so we don't count managers
      // already resolvable via Directory.
      if (!row.resolvedEmail && !row.directoryEmail) missingEmail += 1;
      if (row.slaDueAt) {
        const t = new Date(row.slaDueAt).getTime();
        if (t < now) breached += 1;
        else if (t < now + 48 * 3_600_000) dueSoon += 1;
      }
    }

    return {
      total,
      openFindings,
      resolvedManagers,
      breached,
      dueSoon,
      missingEmail,
      topOffender: topOffender.count > 0 ? topOffender : null,
    };
  }, [rows, now]);

  if (analytics.total === 0) return null;

  const openManagers = analytics.total - analytics.resolvedManagers;
  const resolvedPercent =
    analytics.total > 0 ? Math.round((analytics.resolvedManagers / analytics.total) * 100) : 0;

  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Tile
        label="Managers"
        value={analytics.total}
        hint={`${openManagers} open`}
        tone="gray"
        Icon={Users}
      />
      <Tile
        label="Resolved"
        value={analytics.resolvedManagers}
        hint={analytics.resolvedManagers > 0 ? `${resolvedPercent}% complete` : 'None resolved yet'}
        tone="emerald"
        Icon={CheckCircle2}
      />
      <Tile
        label="Open findings"
        value={analytics.openFindings}
        hint={analytics.topOffender ? `Top: ${analytics.topOffender.name} (${analytics.topOffender.count})` : 'None'}
        tone="blue"
        Icon={Flame}
      />
      <Tile
        label="SLA breached"
        value={analytics.breached}
        hint={analytics.breached > 0 ? 'Action required now' : 'All within SLA'}
        tone={analytics.breached > 0 ? 'red' : 'emerald'}
        Icon={AlertTriangle}
      />
      <Tile
        label="Due in 48h"
        value={analytics.dueSoon}
        hint={analytics.dueSoon > 0 ? 'Plan follow-ups' : 'Nothing imminent'}
        tone={analytics.dueSoon > 0 ? 'amber' : 'gray'}
        Icon={Clock}
      />
      <Tile
        label="Missing email"
        value={analytics.missingEmail}
        hint={analytics.missingEmail > 0 ? 'Add to Directory' : 'All mapped'}
        tone={analytics.missingEmail > 0 ? 'amber' : 'emerald'}
        Icon={Mail}
      />
    </div>
  );
}

type Tone = 'gray' | 'blue' | 'amber' | 'red' | 'emerald';

const TONE: Record<Tone, { bg: string; text: string; chip: string }> = {
  gray:    { bg: 'bg-white dark:bg-gray-900',        text: 'text-gray-900 dark:text-white', chip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  blue:    { bg: 'bg-blue-50 dark:bg-blue-950/40',   text: 'text-blue-900 dark:text-blue-100', chip: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-900 dark:text-amber-100', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200' },
  red:     { bg: 'bg-red-50 dark:bg-red-950/40',     text: 'text-red-900 dark:text-red-100', chip: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-900 dark:text-emerald-100', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200' },
};

function Tile({
  label,
  value,
  hint,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  hint: string;
  tone: Tone;
  Icon: typeof CheckCircle2;
}) {
  const classes = TONE[tone];
  return (
    <div
      className={`rounded-xl border border-rule p-3.5 shadow-soft transition-shadow duration-150 ease-soft hover:shadow-soft-md dark:border-gray-800 ${classes.bg}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${classes.text}`}>
          {label}
        </span>
        <Icon size={14} className={classes.text} />
      </div>
      <div className="mt-1.5 flex items-end gap-2">
        <span className={`text-2xl font-bold tabular-nums tracking-tight ${classes.text}`}>{value}</span>
      </div>
      <div className={`mt-1.5 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${classes.chip}`}>
        {hint}
      </div>
    </div>
  );
}
