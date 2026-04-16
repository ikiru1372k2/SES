export function ProgressBar({ value, indeterminate = false }: { value: number; indeterminate?: boolean }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        className={indeterminate ? 'h-full w-1/3 rounded-full bg-brand/80 transition-all animate-pulse' : 'h-full rounded-full bg-brand transition-all'}
        style={indeterminate ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
