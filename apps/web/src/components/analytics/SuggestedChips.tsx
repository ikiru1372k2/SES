import { chipsForScope } from '@ses/domain';
import type { FunctionId } from '@ses/domain';

export function SuggestedChips({
  functionId,
  onPick,
}: {
  functionId?: FunctionId;
  onPick: (q: string) => void;
}) {
  const chips = chipsForScope(functionId);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className="min-h-[32px] rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-rose-300 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          {c}
        </button>
      ))}
    </div>
  );
}
