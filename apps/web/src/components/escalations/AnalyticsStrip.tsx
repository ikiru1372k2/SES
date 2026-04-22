import { useMemo } from 'react';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { AlertTriangle, CheckCircle2, Clock, Flame, Mail, Users } from 'lucide-react';

interface Props {
  rows: ProcessEscalationManagerRow[];
  now?: number;
}

/**
 * Lightweight analytics strip that lives at the top of the Escalation
 * Center. It derives every number from the already-loaded rows — no extra
 * network call — so it's free to render and always in sync with the table.
 *
 * Keep the five tiles opinionated: the auditor needs to answer five
 * questions at a glance: how many managers in play, how many findings
 * still open, how many SLAs are breached, how many are due soon, and
 * who's the worst offender. Anything more belongs on a separate
 * analytics page.
 */
export function AnalyticsStrip({ rows, now = Date.now() }: Props) {
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
      if (!row.resolvedEmail) missingEmail += 1;
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

  return (
    <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
      <Tile
        label="Managers"
        value={analytics.total}
        hint={`${analytics.resolvedManagers} resolved`}
        tone="gray"
        Icon={Users}
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
    <div className={`rounded-xl border border-gray-200 p-3 shadow-sm dark:border-gray-800 ${classes.bg}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${classes.text}`}>
          {label}
        </span>
        <Icon size={14} className={classes.text} />
      </div>
      <div className="mt-1 flex items-end gap-2">
        <span className={`text-2xl font-bold tabular-nums ${classes.text}`}>{value}</span>
      </div>
      <div className={`mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${classes.chip}`}>
        {hint}
      </div>
    </div>
  );
}
