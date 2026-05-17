export function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-soft transition-shadow hover:shadow-soft-md dark:border-gray-800 dark:bg-gray-900">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-gray-950 dark:text-white">{value}</div>
      {detail ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detail}</div> : null}
    </div>
  );
}
