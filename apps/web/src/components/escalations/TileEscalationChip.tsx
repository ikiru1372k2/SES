import { Link } from 'react-router-dom';
import type { FunctionId } from '@ses/domain';
import { escalationCenterPath } from '../../lib/processRoutes';

export function TileEscalationChip({
  processId,
  functionId,
  managerCount,
}: {
  processId: string;
  functionId: FunctionId;
  managerCount: number;
}) {
  if (managerCount <= 0) return null;
  const qs = new URLSearchParams({ engine: functionId });
  return (
    <Link
      to={escalationCenterPath(processId, qs)}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex text-[11px] font-medium text-brand hover:underline"
    >
      {managerCount} manager{managerCount === 1 ? '' : 's'} flagged here
    </Link>
  );
}
