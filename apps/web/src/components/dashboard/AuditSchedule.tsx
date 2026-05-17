import { Calendar, ChevronRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  bucketedProcesses,
  daysUntilDue,
  type ScheduleBucket,
} from '../../lib/domain/scheduleHelpers';
import { processDashboardPath } from '../../lib/processRoutes';
import type { AuditProcess } from '../../lib/domain/types';

const BUCKET_META: Record<
  ScheduleBucket,
  { title: string; empty: string; tone: 'bad' | 'warn' | 'ok' }
> = {
  overdue: {
    title: 'Overdue',
    empty: 'Nothing overdue',
    tone: 'bad',
  },
  dueThisWeek: {
    title: 'Due this week',
    empty: 'No audits due this week',
    tone: 'warn',
  },
  upcoming: {
    title: 'On track',
    empty: 'Nothing due in the next 8–30 days',
    tone: 'ok',
  },
};

const TONE_STYLES = {
  bad: {
    panel: 'border-danger-200/80 bg-gradient-to-b from-danger-50/90 to-white dark:border-red-900/60 dark:from-red-950/40 dark:to-gray-900',
    header: 'text-danger-900 dark:text-red-100',
    badge: 'bg-danger-100 text-danger-800 ring-danger-200/60 dark:bg-red-950 dark:text-red-200 dark:ring-red-900/50',
    dot: 'bg-danger-500 shadow-[0_0_0_3px_rgba(220,38,38,0.15)]',
    row: 'border-danger-100/80 bg-white/90 hover:border-danger-200 hover:bg-white dark:border-red-900/40 dark:bg-gray-900/80 dark:hover:border-red-800',
    rowMeta: 'text-danger-700/90 dark:text-red-300/90',
  },
  warn: {
    panel: 'border-warning-200/80 bg-gradient-to-b from-warning-50/90 to-white dark:border-amber-900/60 dark:from-amber-950/35 dark:to-gray-900',
    header: 'text-warning-900 dark:text-amber-100',
    badge: 'bg-warning-100 text-warning-900 ring-warning-200/60 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900/50',
    dot: 'bg-warning-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
    row: 'border-warning-100/80 bg-white/90 hover:border-warning-200 hover:bg-white dark:border-amber-900/40 dark:bg-gray-900/80 dark:hover:border-amber-800',
    rowMeta: 'text-warning-800/90 dark:text-amber-300/90',
  },
  ok: {
    panel: 'border-success-200/80 bg-gradient-to-b from-success-50/80 to-white dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-gray-900',
    header: 'text-success-900 dark:text-emerald-100',
    badge: 'bg-success-100 text-success-900 ring-success-200/60 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900/50',
    dot: 'bg-success-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]',
    row: 'border-success-100/80 bg-white/90 hover:border-success-200 hover:bg-white dark:border-emerald-900/40 dark:bg-gray-900/80 dark:hover:border-emerald-800',
    rowMeta: 'text-success-800/90 dark:text-emerald-300/90',
  },
  neutral: {
    panel: 'border-rule bg-surface-app/50 dark:border-gray-800 dark:bg-gray-900/50',
    header: 'text-ink-2 dark:text-gray-300',
    badge: 'bg-white text-ink-3 ring-rule dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700',
    dot: 'bg-ink-3',
    row: 'border-rule bg-white hover:border-brand/30 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand/40',
    rowMeta: 'text-ink-3',
  },
} as const;

function formatDueDate(nextAuditDue: string): string {
  const date = new Date(`${nextAuditDue}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function dueDetail(nextAuditDue: string): string {
  const days = daysUntilDue(nextAuditDue);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days <= 7) return `Due in ${days} day${days === 1 ? '' : 's'}`;
  return formatDueDate(nextAuditDue);
}

function laterProcesses(processes: AuditProcess[]): AuditProcess[] {
  return processes
    .filter((p) => {
      if (!p.nextAuditDue) return false;
      return daysUntilDue(p.nextAuditDue) > 30;
    })
    .sort((a, b) => String(a.nextAuditDue).localeCompare(String(b.nextAuditDue)));
}

function unscheduledProcesses(processes: AuditProcess[]): AuditProcess[] {
  return processes.filter((p) => !p.nextAuditDue).sort((a, b) => a.name.localeCompare(b.name));
}

export function AuditSchedule({ processes }: { processes: AuditProcess[] }) {
  if (processes.length === 0) return null;

  const buckets = bucketedProcesses(processes);
  const later = laterProcesses(processes);
  const unscheduled = unscheduledProcesses(processes);
  const scheduledCount =
    buckets.overdue.length + buckets.dueThisWeek.length + buckets.upcoming.length + later.length;

  if (scheduledCount === 0 && unscheduled.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Audit schedule">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-rule bg-white shadow-soft dark:border-gray-700 dark:bg-gray-900">
            <Calendar size={17} className="text-brand" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-ink dark:text-white">Audit schedule</h2>
            <p className="text-xs text-ink-3">Click any process to open it</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SummaryChip label="Scheduled" value={scheduledCount} />
          <SummaryChip label="Total" value={processes.length} muted />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(['overdue', 'dueThisWeek', 'upcoming'] as const).map((bucket) => (
          <ScheduleColumn key={bucket} bucket={bucket} items={buckets[bucket]} />
        ))}
      </div>

      {later.length > 0 ? (
        <ScheduleExtraSection
          title="Due later"
          subtitle="More than 30 days out"
          items={later}
          className="mt-3"
        />
      ) : null}

      {unscheduled.length > 0 ? (
        <ScheduleExtraSection
          title="No due date"
          subtitle="Set a date when editing the process"
          items={unscheduled}
          unscheduled
          className="mt-3"
        />
      ) : null}
    </section>
  );
}

function SummaryChip({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs shadow-soft ${
        muted
          ? 'border-rule bg-white text-ink-3 dark:border-gray-800 dark:bg-gray-900'
          : 'border-brand/20 bg-brand-subtle font-medium text-brand dark:border-brand/30 dark:bg-brand/15'
      }`}
    >
      <span className="uppercase tracking-wide text-[10px] opacity-80">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function ScheduleColumn({
  bucket,
  items,
}: {
  bucket: ScheduleBucket;
  items: AuditProcess[];
}) {
  const meta = BUCKET_META[bucket];
  const styles = TONE_STYLES[meta.tone];

  return (
    <div
      className={`flex min-h-[120px] flex-col rounded-xl border p-3 shadow-soft transition-shadow hover:shadow-soft-md sm:p-3.5 ${styles.panel}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className={`flex items-center gap-2 text-sm font-semibold ${styles.header}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${styles.dot}`} aria-hidden />
          {meta.title}
        </div>
        <span
          className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ring-1 ${styles.badge}`}
        >
          {items.length}
        </span>
      </div>

      {items.length > 0 ? (
        <ul className="max-h-44 flex-1 space-y-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
          {items.map((process) => (
            <ScheduleProcessRow key={process.id} process={process} tone={meta.tone} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-rule/80 bg-white/50 px-3 py-6 text-center dark:border-gray-700 dark:bg-gray-900/40">
          <p className="text-xs text-ink-3">{meta.empty}</p>
        </div>
      )}
    </div>
  );
}

function ScheduleExtraSection({
  title,
  subtitle,
  items,
  unscheduled = false,
  className = '',
}: {
  title: string;
  subtitle: string;
  items: AuditProcess[];
  unscheduled?: boolean;
  className?: string;
}) {
  const styles = TONE_STYLES.neutral;

  return (
    <div
      className={`rounded-xl border border-rule bg-white p-3.5 shadow-soft dark:border-gray-800 dark:bg-gray-900 sm:p-4 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-rule-2 pb-2.5 dark:border-gray-800">
        <Clock size={14} className="text-ink-3" aria-hidden />
        <h3 className={`text-sm font-semibold ${styles.header}`}>{title}</h3>
        <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ring-1 ${styles.badge}`}>
          {items.length}
        </span>
        <span className="w-full text-[11px] text-ink-3 sm:ml-auto sm:w-auto">{subtitle}</span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((process) => (
          <ScheduleProcessRow key={process.id} process={process} tone="neutral" unscheduled={unscheduled} />
        ))}
      </ul>
    </div>
  );
}

function ScheduleProcessRow({
  process,
  tone,
  unscheduled = false,
}: {
  process: AuditProcess;
  tone: 'bad' | 'warn' | 'ok' | 'neutral';
  unscheduled?: boolean;
}) {
  const styles = TONE_STYLES[tone];
  const due = process.nextAuditDue ? dueDetail(process.nextAuditDue) : null;

  return (
    <li>
      <Link
        to={processDashboardPath(process.displayCode ?? process.id)}
        className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 shadow-[0_1px_0_rgba(16,24,40,0.04)] transition-all duration-150 ${styles.row}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-snug text-ink group-hover:text-brand dark:text-gray-100">
            {process.name}
          </span>
          {!unscheduled && due ? (
            <span className={`mt-0.5 block truncate text-[11px] font-medium ${styles.rowMeta}`}>{due}</span>
          ) : unscheduled ? (
            <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-3">
              {process.displayCode ?? process.id}
            </span>
          ) : null}
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-app text-ink-3 transition-colors group-hover:bg-brand-subtle group-hover:text-brand dark:bg-gray-800 dark:group-hover:bg-brand/20">
          <ChevronRight size={13} aria-hidden />
        </span>
      </Link>
    </li>
  );
}
