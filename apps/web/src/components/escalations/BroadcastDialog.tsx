import { useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Megaphone, Send } from 'lucide-react';
import { broadcastNotification } from '../../lib/api/bulkTrackingApi';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

type Channel = 'email' | 'teams' | 'both';

// A no-frills "tell everyone at once" dialog. The heavy lifting lives on
// the server; the UI just owns the message, the channel, and the scope
// toggle (all open findings vs. only a specific function's findings).
//
// Deliberately simple: the per-recipient render already happens in the
// Composer; Broadcast is the "send one thing to many" path and should
// feel like it.
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
  const [subject, setSubject] = useState('Reminder: open master-data findings');
  const [body, setBody] = useState(
    'Hi {{managerName}},\n\nYou have {{projectCount}} open findings that need attention. Please review and respond by {{dueDate}}.\n\nThanks.',
  );
  const [channel, setChannel] = useState<Channel>('email');
  const [functionId, setFunctionId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
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
      const res = await broadcastNotification({
        processIdOrCode,
        payload: {
          subject: subject.trim(),
          body: body.trim(),
          cc: [],
          sources: [],
          channel,
        },
        filter: functionId ? { functionId } : {},
      });
      if (res.skipped > 0 || res.failed > 0) {
        toast(`Sent ${res.success}/${res.audience} · skipped ${res.skipped} · failed ${res.failed}.`, {
          icon: '⚠️',
        });
      } else {
        toast.success(`Broadcast sent to ${res.success} manager${res.success === 1 ? '' : 's'}.`);
      }
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Broadcast failed');
    } finally {
      setBusy(false);
    }
  }

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

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Channel
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as Channel)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="email">Email only</option>
              <option value="teams">Teams only</option>
              <option value="both">Email + Teams</option>
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
        </div>

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
      </form>
    </Modal>
  );
}
