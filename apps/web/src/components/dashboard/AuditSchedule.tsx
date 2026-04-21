import { Link } from 'react-router-dom';
import { bucketedProcesses, daysUntilDue, type ScheduleBucket } from '../../lib/scheduleHelpers';
import { processDashboardPath } from '../../lib/processRoutes';
import type { AuditProcess } from '../../lib/types';

const labels: Record<ScheduleBucket, { title: string; empty: string; tone: string }> = {
  overdue: { title: 'Overdue', empty: 'Nothing overdue', tone: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200' },
  dueThisWeek: { title: 'Due this week', empty: 'No audits due this week', tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  upcoming: { title: 'Upcoming', empty: 'No upcoming audits', tone: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200' },
};

export function AuditSchedule({ processes }: { processes: AuditProcess[] }) {
  const buckets = bucketedProcesses(processes);
  const hasScheduled = Object.values(buckets).some((items) => items.length > 0);
  if (!hasScheduled) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-950 dark:text-white">Audit Schedule</h2>
          <p className="text-sm text-gray-500">Open items that need attention before the next cycle slips.</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {(['overdue', 'dueThisWeek', 'upcoming'] as const).map((bucket) => (
          <ScheduleColumn key={bucket} bucket={bucket} processes={buckets[bucket]} />
        ))}
      </div>
    </section>
  );
}

function ScheduleColumn({ bucket, processes }: { bucket: ScheduleBucket; processes: AuditProcess[] }) {
  const meta = labels[bucket];
  return (
    <div className={`rounded-xl border p-4 ${meta.tone}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{meta.title}</h3>
        <span className="rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold text-gray-700 dark:bg-black/20 dark:text-gray-100">{processes.length}</span>
      </div>
      <div className="mt-3 space-y-2">
        {processes.length ? processes.slice(0, 5).map((process) => <ScheduleItem key={process.id} process={process} />) : <p className="text-sm opacity-75">{meta.empty}</p>}
      </div>
    </div>
  );
}

function ScheduleItem({ process }: { process: AuditProcess }) {
  const days = process.nextAuditDue ? daysUntilDue(process.nextAuditDue) : 0;
  const label = days < 0 ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue` : days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`;
  return (
    <Link to={processDashboardPath(process.id)} className="block rounded-lg bg-white/75 p-3 text-sm text-gray-900 shadow-sm transition hover:bg-white dark:bg-black/20 dark:text-gray-100 dark:hover:bg-black/30">
      <div className="truncate font-semibold">{process.name}</div>
      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{label}</div>
    </Link>
  );
}
