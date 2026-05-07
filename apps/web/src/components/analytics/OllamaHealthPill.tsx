import { useQuery } from '@tanstack/react-query';
import { fetchAnalyticsHealth } from '../../lib/api/analyticsApi';

export function OllamaHealthPill() {
  const q = useQuery({
    queryKey: ['analytics-health'],
    queryFn: fetchAnalyticsHealth,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const status = !q.data ? 'unknown' : q.data.ok && q.data.ollama === 'up' ? 'up' : q.data.ok ? 'degraded' : 'down';
  const label = status === 'up' ? 'AI ready' : status === 'degraded' ? 'AI degraded' : status === 'down' ? 'AI down' : 'AI…';
  const cls =
    status === 'up'
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200'
      : status === 'degraded'
        ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200'
        : status === 'down'
          ? 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200'
          : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300';
  const tooltip = q.data?.loaded_models?.length
    ? `Loaded: ${q.data.loaded_models.join(', ')}`
    : q.data?.error ?? 'No model loaded';
  return (
    <span title={tooltip} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'up' ? 'bg-emerald-500' : status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}
