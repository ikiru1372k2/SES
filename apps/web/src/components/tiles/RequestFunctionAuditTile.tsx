import type { KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';

export function RequestFunctionAuditTile({ onClick }: { onClick: () => void }) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-500 transition hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand dark:border-gray-700 dark:bg-gray-800"
    >
      <Plus size={22} />
      <span className="font-medium">Request New Function Audit Analysis</span>
      <span className="max-w-[22ch] text-center text-xs">
        Propose a new audit surface. A helpdesk ticket is opened for review.
      </span>
    </button>
  );
}
