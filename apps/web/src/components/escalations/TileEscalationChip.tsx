import { Link } from 'react-router-dom';
import type { FunctionId } from '@ses/domain';
import { escalationCenterPath } from '../../lib/processRoutes';

export function TileEscalationChip({
  processId,
  functionId,
  issueCount,
}: {
  processId: string;
  functionId: FunctionId;
  issueCount: number;
}) {
  if (issueCount <= 0) return null;
  const qs = new URLSearchParams({ engine: functionId });
  const tone = issueCount > 10 ? 'bad' : 'warn';
  const toneClass =
    tone === 'bad'
      ? 'bg-danger-50 text-danger-700 dark:bg-red-950/50 dark:text-red-300'
      : 'bg-warning-50 text-warning-800 dark:bg-amber-950/40 dark:text-amber-200';

  return (
    <Link
      to={escalationCenterPath(processId, qs)}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold hover:underline ${toneClass}`}
    >
      {issueCount} escalation{issueCount === 1 ? '' : 's'}
    </Link>
  );
}
