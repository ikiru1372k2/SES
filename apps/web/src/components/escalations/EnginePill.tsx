import type { FunctionId } from '@ses/domain';
import { getFunctionLabel } from '@ses/domain';

export function EnginePill({
  engine,
  count,
  onClick,
  active,
}: {
  engine: FunctionId;
  count: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const disabled = count === 0;
  const label = getFunctionLabel(engine);
  return (
    <button
      type="button"
      disabled={disabled && !onClick}
      onClick={disabled ? undefined : onClick}
      title={`${label}: ${count}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        disabled
          ? 'cursor-default border-gray-100 bg-gray-50 text-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-600'
          : active
            ? 'border-brand bg-brand/10 text-brand'
            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
      } ${onClick && !disabled ? 'cursor-pointer' : ''}`}
    >
      <span className="max-w-[120px] truncate">{label}</span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
