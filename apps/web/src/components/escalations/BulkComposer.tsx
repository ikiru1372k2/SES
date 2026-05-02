import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Mail, Send } from 'lucide-react';
import { bulkCompose } from '../../lib/api/bulkTrackingApi';
import { openBlankWindow } from '../../lib/outbound/clientHandoff';
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

function buildMailto(item: PreviewItem): string {
  return `mailto:${encodeURIComponent(item.managerEmail ?? '')}?subject=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(item.body)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function writeBulkHandoff(win: Window, drafts: PreviewItem[]): void {
  const sendable = drafts.filter((d) => (d.managerEmail ?? '').trim());
  const rows = sendable.map((d, index) => {
    const body = escapeHtml(d.body);
    return `<section class="row">
      <div class="meta">
        <strong>${index + 1}. ${escapeHtml(d.managerName)}</strong>
        <span>${escapeHtml(d.managerEmail ?? '')}</span>
      </div>
      <div class="actions">
        <a class="btn" href="${buildMailto(d)}">Open Outlook</a>
        <button class="ghost" onclick="copyBody(${index})">Copy body</button>
      </div>
      <pre id="body-${index}">${body}</pre>
    </section>`;
  }).join('');
  win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bulk Outlook handoff</title>
<style>
body{font-family:system-ui,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827}
.wrap{max-width:900px;margin:0 auto}.head{margin-bottom:16px}.head h1{font-size:20px;margin:0 0 6px}.head p{font-size:13px;color:#4b5563;margin:0}
.row{background:white;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px}
.meta{display:flex;justify-content:space-between;gap:12px;font-size:13px}.meta span{color:#6b7280}
.actions{display:flex;gap:8px;margin:12px 0}.btn,.ghost{border-radius:6px;padding:7px 12px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer}
.btn{background:#2563eb;color:white;border:1px solid #2563eb}.ghost{background:white;color:#374151;border:1px solid #d1d5db}
pre{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.5;color:#111827;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;max-height:220px;overflow:auto}
</style></head><body><main class="wrap">
<div class="head"><h1>Bulk Outlook handoff</h1><p>Open each Outlook draft from here. Nothing is recorded in the escalation ladder until you use the individual manager compose flow.</p></div>
${rows || '<p>No managers with email addresses.</p>'}
</main><script>
function copyBody(i){var el=document.getElementById('body-'+i);navigator.clipboard.writeText(el.innerText);}
</script></body></html>`);
  win.document.close();
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

  function openHandoff() {
    const win = openBlankWindow();
    if (!win) { toast.error('Allow popups to open the Outlook handoff.'); return; }
    const skippedReasons = drafts
      .filter((d) => !(d.managerEmail ?? '').trim())
      .map((d) => ({ trackingId: d.trackingId, reason: 'missing_email' }));
    writeBulkHandoff(win, drafts);
    setProgress({
      kind: 'done',
      success: drafts.length - skippedReasons.length,
      failed: 0,
      skipped: skippedReasons.length,
      total: drafts.length,
      skippedReasons,
    });
    toast.success('Outlook handoff prepared.');
    void qc.invalidateQueries({ queryKey: ['escalations'] });
  }

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
  const sendDisabled = drafts.length === 0 || progress.kind === 'sending';

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
                openHandoff();
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
              Prepare Outlook handoff
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
