import { Link } from 'react-router-dom';
import type { ProcessEscalationsSummary } from '@ses/domain';
import { escalationCenterPath } from '../../lib/processRoutes';

export function ProcessDashboardBanner({
  processId,
  summary,
}: {
  processId: string;
  summary: ProcessEscalationsSummary | undefined;
}) {
  if (!summary || summary.managersWithOpenCount <= 0) return null;
  const n = summary.managersWithOpenCount;
  const m = summary.engineCountWithOpen;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <p>
        <span className="font-semibold">{n}</span> manager{n === 1 ? '' : 's'} have open findings across{' '}
        <span className="font-semibold">{m}</span> engine{m === 1 ? '' : 's'}.
      </p>
      <Link
        to={escalationCenterPath(processId)}
        className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
      >
        Open Escalation Center →
      </Link>
    </div>
  );
}
