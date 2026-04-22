import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchInAppNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../lib/api/inAppNotificationsApi';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const feedQ = useQuery({
    queryKey: ['in-app-notifications'],
    queryFn: fetchInAppNotifications,
    refetchInterval: 30_000,
  });
  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['in-app-notifications'] });
    },
  });
  const readAllMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['in-app-notifications'] });
    },
  });

  const unread = feedQ.data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between px-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-gray-500">Notifications</span>
            <button
              type="button"
              onClick={() => readAllMut.mutate()}
              className="text-brand hover:underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {(feedQ.data?.items ?? []).map((item) => (
              <Link
                key={item.id}
                to={item.link ?? '#'}
                onClick={() => {
                  readMut.mutate(item.id);
                  setOpen(false);
                }}
                className={`block rounded border px-2 py-1.5 text-xs ${
                  item.read
                    ? 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-300'
                    : 'border-brand/30 bg-brand/5 text-gray-800 dark:text-gray-100'
                }`}
              >
                <div>{item.message}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
