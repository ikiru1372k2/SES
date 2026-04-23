import { useEffect, useState } from 'react';
import { fetchNotificationLog, type ApiNotificationLog } from '../../lib/api/notificationsApi';

interface SendLogPanelProps {
  processCode: string;
}

function channelLabel(channel: string): string {
  if (channel === 'outlook') return 'Outlook';
  if (channel === 'teams') return 'Teams';
  if (channel === 'eml') return '.eml';
  return channel;
}

export function SendLogPanel({ processCode }: SendLogPanelProps) {
  const [entries, setEntries] = useState<ApiNotificationLog[]>([]);
  const [loading, setLoading] = useState(true); // true = initial load in progress
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchNotificationLog(processCode, { limit: 50 })
      .then((rows) => {
        if (!cancelled) {
          setEntries(rows);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError((err as Error).message ?? 'Failed to load send log');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [processCode]);

  return (
    <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Send log</h3>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-400">No sends recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500 dark:border-gray-700">
                <th scope="col" className="pb-1 pr-3 font-medium">Time</th>
                <th scope="col" className="pb-1 pr-3 font-medium">Recipient</th>
                <th scope="col" className="pb-1 pr-3 font-medium">Channel</th>
                <th scope="col" className="pb-1 pr-3 font-medium">Subject</th>
                <th scope="col" className="pb-1 font-medium">Issues</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-3 text-gray-500">
                    {new Date(entry.sentAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">
                    {entry.managerName ? `${entry.managerName} <${entry.managerEmail}>` : entry.managerEmail}
                  </td>
                  <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{channelLabel(entry.channel)}</td>
                  <td className="max-w-xs truncate py-1 pr-3 text-gray-700 dark:text-gray-300" title={entry.subject}>
                    {entry.subject}
                  </td>
                  <td className="py-1 text-gray-600 dark:text-gray-400">{entry.issueCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
