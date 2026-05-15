import { useMemo } from 'react';
import toast from 'react-hot-toast';
import type { NotificationDraft } from '../../../lib/domain/types';

export function BroadcastComposer({
  drafts,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  onSend,
}: {
  drafts: NotificationDraft[];
  subject: string;
  body: string;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSend: () => void;
}) {
  const recipients = useMemo(
    () => [...new Set(drafts.map((draft) => draft.email).filter((email): email is string => Boolean(email)))],
    [drafts],
  );

  function handleSend() {
    if (!recipients.length) {
      toast.error('No valid manager emails in the audit');
      return;
    }
    onSend();
  }

  return (
    <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[360px_1fr]">
      <section className="flex min-h-0 flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h2 className="font-semibold">Global broadcast</h2>
          <p className="mt-1 text-xs text-gray-500">One generic message to every manager with a valid email.</p>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500">Recipients</div>
          <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-600">
            {recipients.length ? (
              recipients.map((r) => (
                <div key={r} className="truncate text-gray-700 dark:text-gray-300">
                  {r}
                </div>
              ))
            ) : (
              <div className="text-gray-400">No valid emails in this audit.</div>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">{recipients.length} recipient(s)</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">Subject</label>
          <input
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <label className="block text-xs font-medium text-gray-500">Body</label>
          <textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            className="mt-1 min-h-0 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!recipients.length}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
        >
          Send broadcast ({recipients.length})
        </button>
      </section>
      <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <h2 className="font-semibold">Preview</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="mt-4 max-w-2xl whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="text-xs text-gray-500">Subject</div>
            <div className="mt-1 font-semibold">{subject}</div>
            <hr className="my-3 border-gray-200 dark:border-gray-700" />
            <div className="font-sans">{body}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
