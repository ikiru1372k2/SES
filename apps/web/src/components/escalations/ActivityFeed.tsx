import { useQuery } from '@tanstack/react-query';
import { fetchTrackingEvents } from '../../lib/api/escalationsApi';
import { TrackingTimeline } from './TrackingTimeline';

// Thin container — the rendering lives in the reusable TrackingTimeline
// so both this panel and anywhere else that wants an activity feed can
// use the same presentation.
export function ActivityFeed({ trackingIdOrCode }: { trackingIdOrCode: string | null }) {
  const q = useQuery({
    queryKey: ['tracking-events', trackingIdOrCode],
    queryFn: () => fetchTrackingEvents(trackingIdOrCode!),
    enabled: Boolean(trackingIdOrCode),
    // Keep the timeline fresh-feeling during an active escalation session
    // without beating the API to death. Socket.IO already invalidates the
    // parent escalations query; this just picks up sibling-event writes.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (!trackingIdOrCode) {
    return <p className="text-sm text-gray-500">No tracking record for this manager.</p>;
  }
  if (q.isLoading) {
    return (
      <ol className="relative space-y-3 pl-6">
        <span aria-hidden className="absolute left-[11px] top-2 h-[calc(100%-1rem)] w-px bg-gray-200 dark:bg-gray-800" />
        {[0, 1, 2].map((i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[20px] top-0 inline-block h-6 w-6 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
            <div className="h-16 animate-pulse rounded-lg border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900" />
          </li>
        ))}
      </ol>
    );
  }
  if (q.isError) {
    return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  }
  return <TrackingTimeline events={q.data ?? []} />;
}
