import type { ChartSpec, ChartType } from '@ses/domain';

export function ChartPicker({
  current,
  alternatives,
  onSelect,
}: {
  current: ChartSpec;
  alternatives?: ChartSpec[];
  onSelect: (spec: ChartSpec) => void;
}) {
  const options: ChartSpec[] = [current, ...(alternatives ?? [])];
  if (options.length <= 1) return null;
  return (
    <select
      value={current.type}
      onChange={(e) => {
        const target = e.target.value as ChartType;
        const next = options.find((s) => s.type === target);
        if (next) onSelect(next);
      }}
      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800"
      aria-label="Chart type"
    >
      {options.map((s) => (
        <option key={s.type} value={s.type}>{s.type}</option>
      ))}
    </select>
  );
}
