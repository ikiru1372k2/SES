import { JSON_HEADERS, parseApiError } from './client';

export type SavedViewItem = {
  id: string;
  name: string;
  filters: Record<string, string>;
};

export async function fetchSavedViews() {
  const res = await fetch('/api/v1/views', { credentials: 'include' });
  if (!res.ok) throw await parseApiError(res, 'Failed to load saved views');
  return (await res.json()) as { items: SavedViewItem[] };
}

export async function createSavedView(name: string, filters: Record<string, string>) {
  const res = await fetch('/api/v1/views', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, filters }),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to save view');
  return (await res.json()) as SavedViewItem;
}
