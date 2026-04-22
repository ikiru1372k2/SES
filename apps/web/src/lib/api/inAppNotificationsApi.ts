import { JSON_HEADERS, parseApiError } from './client';

export type InAppNotificationItem = {
  id: string;
  message: string;
  link: string | null;
  kind: string;
  createdAt: string;
  read: boolean;
};

export async function fetchInAppNotifications() {
  const res = await fetch('/api/v1/notifications', { credentials: 'include' });
  if (!res.ok) throw await parseApiError(res, 'Failed to load notifications');
  return (await res.json()) as { items: InAppNotificationItem[]; unreadCount: number };
}

export async function markNotificationRead(id: string) {
  const res = await fetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to mark notification read');
}

export async function markAllNotificationsRead() {
  const res = await fetch('/api/v1/notifications/read-all', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to mark all read');
}
