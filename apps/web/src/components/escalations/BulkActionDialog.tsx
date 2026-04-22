import { useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

type Outcome = {
  ok: boolean;
  applied?: number;
  skipped?: Array<{ trackingId: string; reason: string }>;
  count?: number;
  total?: number;
};

type BaseProps = {
  open: boolean;
  onClose: () => void;
  count: number;
  onDone: () => void;
};

// One dialog class per action keeps the form tight and lets us validate
// the minimum a senior tracker UI needs: a reason/note. Native window.prompt
// is gone — nothing in this app uses it anymore.

export function AcknowledgeDialog({
  open,
  onClose,
  count,
  onDone,
  runAction,
}: BaseProps & { runAction: (note: string) => Promise<Outcome> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await runAction(note.trim());
      summarizeOutcome('acknowledged', result);
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bulk acknowledge failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Acknowledge ${count} ${pluralize('finding', count)}`}
      description="Marks the selected escalations as responded. Add a short note so the activity trail shows why."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="ack-form" disabled={busy}>
            {busy ? 'Applying…' : `Acknowledge ${count}`}
          </Button>
        </>
      }
    >
      <form id="ack-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
          Note (optional but recommended)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. PM confirmed they'll fix in the master system by Friday."
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </form>
    </Modal>
  );
}

export function SnoozeDialog({
  open,
  onClose,
  count,
  onDone,
  runAction,
}: BaseProps & { runAction: (days: number, note: string) => Promise<Outcome> }) {
  const [days, setDays] = useState(3);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDays(3);
      setNote('');
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (days < 1 || days > 90) {
      toast.error('Days must be 1–90.');
      return;
    }
    setBusy(true);
    try {
      const result = await runAction(days, note.trim());
      summarizeOutcome('snoozed', result);
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bulk snooze failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Snooze ${count} ${pluralize('finding', count)}`}
      description="Pushes the SLA deadline forward. Stage stays the same; the SLA cron will re-evaluate after."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="snooze-form" disabled={busy}>
            {busy ? 'Applying…' : `Snooze ${days}d`}
          </Button>
        </>
      }
    >
      <form id="snooze-form" onSubmit={submit} className="space-y-4">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
          Days to snooze (1 – 90)
          <div className="mt-2 flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={90}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="flex-1"
            />
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setDays(Number.isFinite(parsed) ? parsed : 1);
              }}
              className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {[1, 3, 7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                {d}d
              </button>
            ))}
          </div>
        </label>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
          Reason
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Waiting on finance approval, revisit next week."
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </form>
    </Modal>
  );
}

export function ReescalateDialog({
  open,
  onClose,
  count,
  onDone,
  runAction,
}: BaseProps & { runAction: (note: string) => Promise<Outcome> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await runAction(note.trim());
      summarizeOutcome('re-escalated', result);
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bulk re-escalate failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Re-escalate ${count} ${pluralize('finding', count)}`}
      description="Walks the ladder: SENT/AWAITING/NO_RESPONSE → L1, L1 → L2. Rows that can't move are skipped."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="reesc-form" variant="danger" disabled={busy}>
            {busy ? 'Applying…' : `Re-escalate ${count}`}
          </Button>
        </>
      }
    >
      <form id="reesc-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
          Reason (shown on the activity trail)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. No response in 5 business days, escalating to BU head."
            rows={3}
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </form>
    </Modal>
  );
}

function pluralize(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

// Show a single toast per action summarizing applied vs skipped. Matches the
// Jira / Linear convention of one structured outcome bubble instead of one
// toast per item.
function summarizeOutcome(verb: string, result: Outcome): void {
  const applied = result.applied ?? result.count ?? 0;
  const skipped = result.skipped?.length ?? 0;
  if (skipped === 0) {
    toast.success(`${applied} ${verb}.`);
    return;
  }
  const reasons = new Set(result.skipped!.map((s) => s.reason));
  const reasonList = [...reasons].slice(0, 2).join('; ');
  toast(
    `${applied} ${verb}, ${skipped} skipped (${reasonList}${reasons.size > 2 ? '…' : ''}).`,
    { icon: '⚠️' },
  );
}
