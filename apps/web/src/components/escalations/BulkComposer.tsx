import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { bulkCompose, bulkSend } from '../../lib/api/bulkTrackingApi';
import { PreviewPane } from './PreviewPane';

type PreviewItem = {
  trackingId: string;
  managerName: string;
  managerEmail: string | null;
  subject: string;
  body: string;
};

function nextItem(items: PreviewItem[], index: number): PreviewItem | null {
  return items[index] ?? null;
}

export function BulkComposer({
  trackingIds,
  open,
  onClose,
}: {
  trackingIds: string[];
  open: boolean;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const [drafts, setDrafts] = useState<PreviewItem[]>([]);
  const [progressText, setProgressText] = useState('');
  const qc = useQueryClient();

  const loadMut = useMutation({
    mutationFn: () => bulkCompose(trackingIds),
    onSuccess: (data) => setDrafts(data.previews),
    onError: (error: Error) => toast.error(error.message),
  });

  const sendMut = useMutation({
    mutationFn: () =>
      bulkSend(
        trackingIds,
        {
          subject: drafts[active]?.subject ?? '',
          body: drafts[active]?.body ?? '',
          cc: [],
          sources: [],
          channel: 'email',
        },
      ),
    onSuccess: async (result) => {
      setProgressText(`Sent ${result.success}/${result.total}, failed ${result.failed}`);
      await qc.invalidateQueries({ queryKey: ['escalations'] });
      if (result.failed === 0) {
        toast.success('Bulk send complete');
        onClose();
      } else {
        toast.error(`Bulk send complete with ${result.failed} failures`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!open || drafts.length > 0 || loadMut.isPending) return;
    loadMut.mutate();
  }, [drafts.length, loadMut, open]);

  if (!open) return null;

  const current = drafts[active];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex h-[80vh] w-full max-w-5xl flex-col rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Bulk composer ({trackingIds.length})</h2>
          <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mb-2 flex gap-1 overflow-x-auto">
          {drafts.map((item, index) => (
            <button
              key={item.trackingId}
              type="button"
              onClick={() => setActive(index)}
              className={`rounded border px-2 py-1 text-xs ${
                index === active ? 'border-brand bg-brand/5 text-brand' : 'border-gray-300'
              }`}
            >
              {item.managerName}
            </button>
          ))}
        </div>
        {current ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mb-2 text-xs text-gray-500">{current.managerEmail ?? 'No email mapped'}</div>
            <input
              value={current.subject}
              onChange={(event) => {
                const currentDraft = nextItem(drafts, active);
                if (!currentDraft) return;
                const next = [...drafts];
                next[active] = { ...currentDraft, subject: event.target.value };
                setDrafts(next);
              }}
              className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
            <textarea
              value={current.body}
              onChange={(event) => {
                const currentDraft = nextItem(drafts, active);
                if (!currentDraft) return;
                const next = [...drafts];
                next[active] = { ...currentDraft, body: event.target.value };
                setDrafts(next);
              }}
              rows={8}
              className="mb-3 w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
            <PreviewPane subject={current.subject} body={current.body} />
          </div>
        ) : (
          <div className="text-sm text-gray-500">Loading previews...</div>
        )}
        <div className="mt-3 flex items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
          <div className="text-xs text-gray-500">{progressText}</div>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            disabled={sendMut.isPending || drafts.length === 0}
            onClick={() => sendMut.mutate()}
          >
            Send all {trackingIds.length}
          </button>
        </div>
      </div>
    </div>
  );
}
