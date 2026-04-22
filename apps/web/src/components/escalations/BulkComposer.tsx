import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Mail, Send } from 'lucide-react';
import { bulkCompose, bulkSend } from '../../lib/api/bulkTrackingApi';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { PreviewPane } from './PreviewPane';

type PreviewItem = {
  trackingId: string;
  managerName: string;
  managerEmail: string | null;
  subject: string;
  body: string;
};

// Tokens the composer supports in-place. Keep this list short and obvious —
// a Jira-like app doesn't need a full template engine, it needs a handful
// of reliable substitutions the user can see before sending.
const TEMPLATE_HINTS: Array<{ token: string; description: string }> = [
  { token: '{{managerName}}', description: 'The manager being notified' },
  { token: '{{projectCount}}', description: 'Number of flagged projects' },
  { token: '{{dueDate}}', description: 'SLA due date (if set)' },
  { token: '{{auditRunCode}}', description: 'Parent audit run code' },
];

type Progress = {
  kind: 'idle' | 'sending' | 'done';
  success: number;
  failed: number;
  skipped: number;
  total: number;
  skippedReasons: Array<{ trackingId: string; reason: string }>;
};

const INITIAL_PROGRESS: Progress = {
  kind: 'idle',
  success: 0,
  failed: 0,
  skipped: 0,
  total: 0,
  skippedReasons: [],
};

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
  const [progress, setProgress] = useState<Progress>(INITIAL_PROGRESS);
  const [confirming, setConfirming] = useState(false);
  const qc = useQueryClient();

  const loadMut = useMutation({
    mutationFn: () => bulkCompose(trackingIds),
    onSuccess: (data) => {
      setDrafts(data.previews);
      setActive(0);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendMut = useMutation({
    mutationFn: () =>
      bulkSend(trackingIds, {
        subject: drafts[active]?.subject ?? '',
        body: drafts[active]?.body ?? '',
        cc: [],
        sources: [],
        channel: 'email',
      }),
    onMutate: () => {
      setProgress({
        kind: 'sending',
        success: 0,
        failed: 0,
        skipped: 0,
        total: trackingIds.length,
        skippedReasons: [],
      });
    },
    onSuccess: async (result) => {
      const skippedReasons = (result.progress ?? [])
        .filter((row) => row['state'] === 'skipped' || row['state'] === 'failed')
        .map((row) => ({
          trackingId: String(row['trackingId'] ?? ''),
          reason: String(row['reason'] ?? row['error'] ?? 'unknown'),
        }));
      const skipped = (result as { skipped?: number }).skipped ?? 0;
      setProgress({
        kind: 'done',
        success: result.success,
        failed: result.failed,
        skipped,
        total: result.total,
        skippedReasons,
      });
      await qc.invalidateQueries({ queryKey: ['escalations'] });
      if (result.failed === 0 && skipped === 0) {
        toast.success(`Sent ${result.success} notification${result.success === 1 ? '' : 's'}.`);
      } else {
        toast(
          `Sent ${result.success} · skipped ${skipped} · failed ${result.failed}.`,
          { icon: '⚠️' },
        );
      }
    },
    onError: (error: Error) => {
      setProgress((p) => ({ ...p, kind: 'done', failed: trackingIds.length }));
      toast.error(error.message);
    },
  });

  // Load drafts once per modal opening. Deps are explicit so we don't
  // rerun when drafts change (that would overwrite the user's edits).
  useEffect(() => {
    if (!open) return;
    setProgress(INITIAL_PROGRESS);
    setConfirming(false);
    loadMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackingIds.join('|')]);

  const current = drafts[active];
  const missingEmailCount = useMemo(
    () => drafts.filter((d) => !(d.managerEmail ?? '').trim()).length,
    [drafts],
  );
  const sendDisabled = sendMut.isPending || drafts.length === 0 || progress.kind === 'sending';

  function updateCurrent(patch: Partial<PreviewItem>) {
    if (!current) return;
    setDrafts((prev) => {
      const next = [...prev];
      next[active] = { ...current, ...patch };
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (progress.kind === 'sending') return;
        onClose();
      }}
      title={`Compose to ${trackingIds.length} manager${trackingIds.length === 1 ? '' : 's'}`}
      description="Each manager gets their own subject and body. Tokens like {{managerName}} are substituted per-recipient at send time."
      size="xl"
      dismissOnOverlayClick={progress.kind !== 'sending'}
      footer={
        <>
          <div className="mr-auto flex items-center gap-3 text-xs text-gray-500">
            {missingEmailCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <AlertTriangle size={14} /> {missingEmailCount} missing email — those rows will be skipped.
              </span>
            ) : null}
            {progress.kind === 'sending' ? <span>Sending…</span> : null}
            {progress.kind === 'done' ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={14} /> Sent {progress.success}/{progress.total}
                {progress.skipped ? ` · skipped ${progress.skipped}` : ''}
                {progress.failed ? ` · failed ${progress.failed}` : ''}
              </span>
            ) : null}
          </div>
          <Button variant="secondary" onClick={onClose} disabled={progress.kind === 'sending'}>
            Close
          </Button>
          {confirming ? (
            <Button
              onClick={() => {
                sendMut.mutate();
                setConfirming(false);
              }}
              disabled={sendDisabled}
              leading={<Send size={14} />}
            >
              Confirm and send {trackingIds.length}
            </Button>
          ) : (
            <Button
              onClick={() => setConfirming(true)}
              disabled={sendDisabled}
              leading={<Mail size={14} />}
            >
              Send all {trackingIds.length}
            </Button>
          )}
        </>
      }
    >
      {loadMut.isPending ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading previews…</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[14rem,1fr]">
          <nav className="max-h-[60vh] overflow-auto rounded-lg border border-gray-100 p-1 dark:border-gray-800">
            {drafts.map((item, index) => {
              const noEmail = !(item.managerEmail ?? '').trim();
              return (
                <button
                  key={item.trackingId}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                    index === active
                      ? 'bg-brand/10 text-brand'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.managerName}</span>
                    <span
                      className={`block truncate text-[10px] ${
                        noEmail ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400'
                      }`}
                    >
                      {item.managerEmail || 'no email'}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          {current ? (
            <section className="min-h-[60vh] overflow-auto">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>
                  To: <strong>{current.managerName}</strong>
                </span>
                <span>{current.managerEmail || 'missing email — row will be skipped'}</span>
              </div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Subject
                <input
                  value={current.subject}
                  onChange={(event) => updateCurrent({ subject: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Body
                <textarea
                  value={current.body}
                  onChange={(event) => updateCurrent({ body: event.target.value })}
                  rows={10}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
              <details className="mt-2 rounded-lg border border-gray-100 px-2 py-1 text-xs dark:border-gray-800">
                <summary className="cursor-pointer text-gray-500">Template tokens</summary>
                <ul className="mt-2 space-y-0.5">
                  {TEMPLATE_HINTS.map((hint) => (
                    <li key={hint.token} className="flex items-center gap-2">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                        {hint.token}
                      </code>
                      <span className="text-gray-500">{hint.description}</span>
                    </li>
                  ))}
                </ul>
              </details>
              <div className="mt-3">
                <PreviewPane subject={current.subject} body={current.body} />
              </div>

              {progress.kind !== 'idle' ? (
                <div className="mt-3 space-y-1 rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs dark:border-gray-800 dark:bg-gray-950">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      Progress: {progress.success + progress.failed + progress.skipped}/{progress.total}
                    </span>
                    <span className="text-gray-500">
                      ok {progress.success} · skip {progress.skipped} · fail {progress.failed}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
                    <div
                      className="h-full bg-brand transition-all"
                      style={{
                        width: `${
                          progress.total
                            ? ((progress.success + progress.failed + progress.skipped) / progress.total) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  {progress.skippedReasons.length ? (
                    <ul className="mt-1 max-h-24 overflow-auto">
                      {progress.skippedReasons.map((row) => (
                        <li key={row.trackingId} className="text-[11px] text-amber-700 dark:text-amber-300">
                          {row.trackingId}: {row.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : (
            <div className="flex items-center justify-center text-sm text-gray-500">
              No previews available.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
