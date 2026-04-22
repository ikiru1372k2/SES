import { useQuery } from '@tanstack/react-query';
import { fetchTrackingEvents, type TrackingEventDto } from '../../lib/api/escalationsApi';

export function ActivityFeed({ trackingIdOrCode }: { trackingIdOrCode: string | null }) {
  const q = useQuery({
    queryKey: ['tracking-events', trackingIdOrCode],
    queryFn: () => fetchTrackingEvents(trackingIdOrCode!),
    enabled: Boolean(trackingIdOrCode),
  });
  if (!trackingIdOrCode) {
    return <p className="text-sm text-gray-500">No tracking record for this manager.</p>;
  }
  if (q.isLoading) return <p className="text-sm text-gray-500">Loading activity…</p>;
  if (q.isError) {
    return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  }
  const events = q.data ?? [];
  if (!events.length) {
    return <p className="text-sm text-gray-500">No events yet.</p>;
  }
  return (
    <ul className="space-y-3 text-sm">
      {events.map((e: TrackingEventDto) => (
        <li key={e.id} className="rounded-lg border border-gray-100 p-2 dark:border-gray-800">
          <div className="text-xs text-gray-400">{new Date(e.at).toLocaleString()}</div>
          <div className="font-medium text-gray-800 dark:text-gray-100">{e.kind}</div>
          <div className="text-gray-600 dark:text-gray-300">{e.channel}</div>
          {e.note ? <div className="mt-1 text-gray-700 dark:text-gray-200">{e.note}</div> : null}
          {e.reason ? <div className="text-xs text-gray-500">Reason: {e.reason}</div> : null}
        </li>
      ))}
    </ul>
  );
}
