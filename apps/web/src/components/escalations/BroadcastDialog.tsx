import { useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Megaphone, Send } from 'lucide-react';
import { broadcastNotification } from '../../lib/api/bulkTrackingApi';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { PreviewPane } from './PreviewPane';

// Issue #75: 'both' was supported when the server did the sending via SMTP
// + Teams webhook. The client-handoff model opens the user's own app, one
// channel at a time; 'both' would require two tabs per recipient which is
// not a useful broadcast UX. Channel is pick-one.
type Channel = 'email' | 'teams';

function addBusinessDays(base: Date, days: number): Date {
  const d = new Date(base);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added += 1;
  }
  return d;
}

function toDateInputValue(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// A no-frills "tell everyone at once" dialog. Issue #75 keeps the bulk
// broadcast API (one server-side round-trip for the whole audience), but
// the dialog now opens preview-first and carries a due date + auditor note
// so the auditor reviews the copy against a representative recipient before
// firing.
export function BroadcastDialog({
  processIdOrCode,
  open,
  onClose,
  onDone,
  estimatedAudience,
  functionOptions = [],
}: {
  processIdOrCode: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  estimatedAudience: number;
  functionOptions?: Array<{ id: string; label: string }>;
}) {
  const [view, setView] = useState<'preview' | 'edit'>('preview');
  const [subject, setSubject] = useState('Reminder: open findings for your review');
  const [body, setBody] = useState(
    'Hi {{managerName}},\n\nYou have {{projectCount}} open findings that need attention. Please review and respond by {{dueDate}}.\n\nThanks.',
  );
  const [channel, setChannel] = useState<Channel>('email');
  const [functionId, setFunctionId] = useState<string>('');
  const [authorNote, setAuthorNote] = useState('');
  const [deadlineAt, setDeadlineAt] = useState<string>(() =>
    toDateInputValue(addBusinessDays(new Date(), 5)),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setView('preview');
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (estimatedAudience === 0) {
      toast.error('Nobody has open findings to notify.');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required.');
      return;
    }
    setBusy(true);
    try {
      const payload: Parameters<typeof broadcastNotification>[0]['payload'] = {
        subject: subject.trim(),
        body: body.trim(),
        cc: [],
        sources: [],
        channel,
        deadlineAt: deadlineAt || null,
      };
      const note = authorNote.trim();
      if (note) payload.authorNote = note;
      const res = await broadcastNotification({
        processIdOrCode,
        payload,
        filter: functionId ? { functionId } : {},
      });
      if (res.skipped > 0 || res.failed > 0) {
        toast(`Recorded ${res.success}/${res.audience} · skipped ${res.skipped} · failed ${res.failed}.`, {
          icon: '⚠️',
        });
      } else {
        toast.success(`Broadcast recorded for ${res.success} manager${res.success === 1 ? '' : 's'}.`);
      }
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Broadcast failed');
    } finally {
      setBusy(false);
    }
  }

  // Cheap per-recipient substitution for the preview. The server does the
  // authoritative substitution at send time — this is a readability aid so
  // the auditor sees what a manager will receive.
  const previewSubject = subject
    .replace(/\{\{managerName\}\}/g, '<first manager>')
    .replace(/\{\{projectCount\}\}/g, '3')
    .replace(/\{\{dueDate\}\}/g, deadlineAt ? new Date(deadlineAt).toLocaleDateString() : '—')
    .replace(/\{\{auditRunCode\}\}/g, 'ARN-…');
  const previewBody = body
    .replace(/\{\{managerName\}\}/g, '<first manager>')
    .replace(/\{\{projectCount\}\}/g, '3')
    .replace(/\{\{dueDate\}\}/g, deadlineAt ? new Date(deadlineAt).toLocaleDateString() : '—')
    .replace(/\{\{auditRunCode\}\}/g, 'ARN-…');

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      title={
        <span className="flex items-center gap-2">
          <Megaphone size={16} className="text-brand" /> Broadcast to everyone with open findings
        </span>
      }
      description={`One message, sent to every manager with at least one open finding in this process. Missing-email rows are skipped.`}
      size="lg"
      dismissOnOverlayClick={!busy}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setView(view === 'preview' ? 'edit' : 'preview')}
            disabled={busy}
          >
            {view === 'preview' ? 'Edit' : 'Preview'}
          </Button>
          <Button
            type="submit"
            form="broadcast-form"
            disabled={busy || estimatedAudience === 0}
            leading={<Send size={14} />}
          >
            {busy ? 'Sending…' : `Send to ${estimatedAudience}`}
          </Button>
        </>
      }
    >
      <form id="broadcast-form" onSubmit={submit} className="space-y-3">
        <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-brand">
          Recipients: <strong>{estimatedAudience}</strong>{' '}
          manager{estimatedAudience === 1 ? '' : 's'} currently selected as audience.
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Channel
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as Channel)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="email">Email</option>
              <option value="teams">Teams</option>
            </select>
          </label>
          {functionOptions.length > 0 ? (
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Limit to function
              <select
                value={functionId}
                onChange={(event) => setFunctionId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">All functions</option>
                {functionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Due date
            <input
              type="date"
              value={deadlineAt}
              onChange={(event) => setDeadlineAt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
        </div>

        {view === 'edit' ? (
          <>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Subject
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                required
              />
            </label>

            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Body
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={8}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed dark:border-gray-700 dark:bg-gray-900"
              />
              <span className="mt-1 block text-[10px] text-gray-500">
                Tokens: {`{{managerName}}`}, {`{{projectCount}}`}, {`{{dueDate}}`}, {`{{auditRunCode}}`} —
                substituted per-recipient at send time.
              </span>
            </label>
          </>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              Preview (representative recipient — tokens are rendered per-manager at send time)
            </div>
            <PreviewPane subject={previewSubject} body={previewBody} deadlineAt={deadlineAt || null} />
          </div>
        )}

        <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Auditor note (internal — not shown to recipients)
          <textarea
            value={authorNote}
            onChange={(event) => setAuthorNote(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </form>
    </Modal>
  );
}
