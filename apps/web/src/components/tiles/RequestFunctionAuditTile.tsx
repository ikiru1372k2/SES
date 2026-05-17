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
      className="flex min-h-[170px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-rule bg-white p-[18px] text-ink-3 transition-all ease-soft hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand dark:border-gray-700 dark:bg-gray-900"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-rule-2 text-ink-3 dark:border-gray-700">
        <Plus size={18} strokeWidth={1.75} />
      </span>
      <span className="text-[13px] font-semibold text-ink-2 dark:text-gray-200">Request a new function audit</span>
      <span className="text-[11.5px] text-ink-3">Admin will be notified</span>
    </button>
  );
}
