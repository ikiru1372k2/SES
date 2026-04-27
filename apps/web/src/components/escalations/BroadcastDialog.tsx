import { useEffect, useRef, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Mail,
  Megaphone,
  MessageSquare,
  Send,
} from 'lucide-react';
import {
  broadcastNotification,
  type BroadcastOutcome,
  type BroadcastRecipient,
} from '../../lib/api/bulkTrackingApi';
import { openMailto, openTeamsChat } from '../../lib/outbound/clientHandoff';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { PreviewPane } from './PreviewPane';

// Issue #75: 'both' was removed (client-handoff opens one app at a time).
type Channel = 'email' | 'teams';

// ── Template presets ─────────────────────────────────────────────────────────

interface TemplatePreset {
  id: string;
  label: string;
  subject: string;
  body: string;
}

const OUTLOOK_PRESETS: TemplatePreset[] = [
  {
    id: 'reminder',
    label: 'Reminder',
    subject: 'Reminder: open findings awaiting your review',
    body: `Hi {{managerName}},

This is a friendly reminder that you have {{projectCount}} open finding(s) in the current audit that require your attention.

Please review and resolve them by {{dueDate}}.

If you have questions or need clarification on any of the findings, feel free to reach out directly.

Best regards`,
  },
  {
    id: 'escalation',
    label: 'Escalation',
    subject: 'Action required: audit findings remain unresolved',
    body: `Hi {{managerName}},

We are following up on the {{projectCount}} audit finding(s) assigned to you that remain open past the initial review period.

These findings need to be addressed by {{dueDate}}. If unresolved, this will be escalated further in line with our audit policy.

Please log in and review the findings at your earliest convenience.

Regards`,
  },
  {
    id: 'final',
    label: 'Final Notice',
    subject: 'FINAL NOTICE: Audit findings — immediate action required',
    body: `Hi {{managerName}},

This is a final notice regarding {{projectCount}} unresolved audit finding(s) assigned to you.

These findings have been outstanding past all prior deadlines. Immediate resolution is required by {{dueDate}}.

Failure to respond will result in escalation to senior management.

Please contact us directly if you require assistance.

Regards`,
  },
];

const TEAMS_PRESETS: TemplatePreset[] = [
  {
    id: 'teams-reminder',
    label: 'Reminder',
    subject: 'Audit reminder',
    body: `Hi {{managerName}}, just a heads-up that you have {{projectCount}} open audit finding(s) to review by {{dueDate}}. Please take a look when you get a chance. Thanks`,
  },
  {
    id: 'teams-escalation',
    label: 'Escalation',
    subject: 'Action needed — audit findings',
    body: `Hi {{managerName}}, following up on the {{projectCount}} audit finding(s) still open for your review. These need attention by {{dueDate}}. Please let me know if you have questions.`,
  },
  {
    id: 'teams-final',
    label: 'Final Notice',
    subject: 'Final notice — audit findings',
    body: `Hi {{managerName}}, this is a final notice. {{projectCount}} audit finding(s) remain unresolved and must be addressed by {{dueDate}}. Please action immediately.`,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function substitutePreview(text: string, deadline: string): string {
  return text
    .replace(/\{\{managerName\}\}/g, 'Alex Johnson')
    .replace(/\{\{projectCount\}\}/g, '4')
    .replace(/\{\{dueDate\}\}/g, deadline ? new Date(deadline).toLocaleDateString() : '—')
    .replace(/\{\{auditRunCode\}\}/g, 'ARN-0042');
}

// ── Channel toggle ────────────────────────────────────────────────────────────

function ChannelToggle({
  value,
  onChange,
}: {
  value: Channel;
  onChange: (c: Channel) => void;
}) {
  return (
    <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800/50">
      {(['email', 'teams'] as Channel[]).map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all ${
              active
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {c === 'email' ? <Mail size={14} /> : <MessageSquare size={14} />}
            {c === 'email' ? 'Outlook' : 'Teams'}
          </button>
        );
      })}
    </div>
  );
}

// ── Template preset strip ─────────────────────────────────────────────────────

function TemplateStrip({
  presets,
  activeId,
  onSelect,
}: {
  presets: TemplatePreset[];
  activeId: string | null;
  onSelect: (p: TemplatePreset) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {presets.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            activeId === p.id
              ? 'border-brand bg-brand/10 text-brand dark:border-brand dark:bg-brand/20 dark:text-red-300'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Paste import panel ────────────────────────────────────────────────────────

function PasteImport({ onImport }: { onImport: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  function apply() {
    if (!text.trim()) return;
    onImport(text.trim());
    setText('');
    setOpen(false);
    toast.success('Template imported.');
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ClipboardPaste size={12} />
        {open ? 'Cancel import' : 'Paste template'}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open ? (
        <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <p className="mb-2 text-[11px] text-gray-500">
            Paste the message body from any email editor. Template tokens (
            <code>{'{{managerName}}'}</code>, <code>{'{{projectCount}}'}</code>,{' '}
            <code>{'{{dueDate}}'}</code>) are preserved and substituted per-recipient at send time.
          </p>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Paste your template body here…"
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setOpen(false); setText(''); }}>
              Cancel
            </Button>
            <Button type="button" onClick={apply} disabled={!text.trim()}>
              Use this template
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Cycle indicator ───────────────────────────────────────────────────────────

function CycleIndicator({ channel }: { channel: Channel }) {
  const steps = [
    { label: 'Outlook #1', ch: 'email' as Channel },
    { label: 'Outlook #2', ch: 'email' as Channel },
    { label: 'Teams', ch: 'teams' as Channel },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-gray-800/50">
      <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        Cycle
      </span>
      {steps.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              s.ch === channel
                ? 'bg-brand/10 text-brand dark:bg-brand/20 dark:text-red-300'
                : 'text-gray-400'
            }`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 ? (
            <span className="text-gray-300 dark:text-gray-700">›</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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
  const [view, setView] = useState<'compose' | 'preview' | 'handoff'>('compose');
  const [channel, setChannel] = useState<Channel>('email');
  const [activePresetId, setActivePresetId] = useState<string | null>('reminder');
  const [subject, setSubject] = useState(OUTLOOK_PRESETS[0].subject);
  const [body, setBody] = useState(OUTLOOK_PRESETS[0].body);
  const [functionId, setFunctionId] = useState<string>('');
  const [authorNote, setAuthorNote] = useState('');
  const [deadlineAt, setDeadlineAt] = useState<string>(() =>
    toDateInputValue(addBusinessDays(new Date(), 5)),
  );
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BroadcastOutcome | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());

  const presets = channel === 'teams' ? TEAMS_PRESETS : OUTLOOK_PRESETS;

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setView('compose');
    setOutcome(null);
    setOpenedIds(new Set());
    setChannel('email');
    const first = OUTLOOK_PRESETS[0];
    setActivePresetId(first.id);
    setSubject(first.subject);
    setBody(first.body);
    setAuthorNote('');
    setDeadlineAt(toDateInputValue(addBusinessDays(new Date(), 5)));
  }, [open]);

  // When channel changes, load the matching first preset
  function handleChannelChange(c: Channel) {
    setChannel(c);
    const list = c === 'teams' ? TEAMS_PRESETS : OUTLOOK_PRESETS;
    const first = list[0];
    setActivePresetId(first.id);
    setSubject(first.subject);
    setBody(first.body);
  }

  function handlePresetSelect(p: TemplatePreset) {
    setActivePresetId(p.id);
    setSubject(p.subject);
    setBody(p.body);
  }

  function handlePasteImport(text: string) {
    setActivePresetId(null);
    setBody(text);
  }

  // Handoff helpers
  function handoffOne(recipient: BroadcastRecipient): boolean {
    if (recipient.state !== 'sent' || !recipient.managerEmail) return false;
    const ok =
      recipient.channel === 'teams'
        ? openTeamsChat({ to: recipient.managerEmail, message: `${recipient.subject}\n\n${recipient.body}` })
        : openMailto({ to: recipient.managerEmail, cc: recipient.cc, subject: recipient.subject, body: recipient.body });
    if (ok) {
      setOpenedIds((prev) => {
        const next = new Set(prev);
        next.add(recipient.trackingId);
        return next;
      });
    }
    return ok;
  }

  function handoffAll(recipients: BroadcastRecipient[]) {
    const sendable = recipients.filter((r) => r.state === 'sent');
    let blocked = 0;
    for (const r of sendable) {
      if (openedIds.has(r.trackingId)) continue;
      if (!handoffOne(r)) blocked += 1;
    }
    if (blocked > 0) {
      toast(`Opened what the browser allowed. ${blocked} blocked — use per-row Open button.`, { icon: '⚠️' });
    }
  }

  function finishHandoff() {
    onDone();
    onClose();
  }

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
        toast(`Recorded ${res.success}/${res.audience} · skipped ${res.skipped} · failed ${res.failed}.`, { icon: '⚠️' });
      } else {
        toast.success(`Broadcast recorded for ${res.success} manager${res.success === 1 ? '' : 's'}.`);
      }
      // Issue #75: server recorded intent + advanced stages. Now open
      // the user's Outlook/Teams per recipient for actual send.
      setOutcome(res);
      setView('handoff');
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Broadcast failed');
    } finally {
      setBusy(false);
    }
  }

  const isHandoff = view === 'handoff';
  const handoffRecipients = outcome?.recipients ?? [];
  const sentRecipients = handoffRecipients.filter(
    (r): r is Extract<BroadcastRecipient, { state: 'sent' }> => r.state === 'sent',
  );
  type NotSentRecipient = Extract<BroadcastRecipient, { state: 'skipped' | 'failed' }>;
  const skippedRecipients = handoffRecipients.filter((r): r is NotSentRecipient => r.state === 'skipped');
  const failedRecipients = handoffRecipients.filter((r): r is NotSentRecipient => r.state === 'failed');
  const allOpened = sentRecipients.length > 0 && sentRecipients.every((r) => openedIds.has(r.trackingId));
  const channelLabel = channel === 'teams' ? 'Teams' : 'Outlook';

  const previewSubject = substitutePreview(subject, deadlineAt);
  const previewBody = substitutePreview(body, deadlineAt);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        if (isHandoff) { finishHandoff(); return; }
        onClose();
      }}
      title={
        <span className="flex items-center gap-2">
          <Megaphone size={16} className="text-brand" />
          {isHandoff
            ? `Open in ${channelLabel} — ${sentRecipients.length} recorded`
            : 'Broadcast'}
        </span>
      }
      description={
        isHandoff
          ? `Stage and last-contact updated for all recipients. Click Open to launch ${channelLabel} with prefilled message.`
          : 'Send one message to every manager with open findings in this process.'
      }
      size="lg"
      dismissOnOverlayClick={!busy}
      footer={
        isHandoff ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handoffAll(handoffRecipients)}
              disabled={sentRecipients.length === 0 || allOpened}
            >
              Open all in {channelLabel}
            </Button>
            <Button type="button" onClick={finishHandoff} leading={<CheckCircle2 size={14} />}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setView(view === 'preview' ? 'compose' : 'preview')}
              disabled={busy}
            >
              {view === 'preview' ? 'Edit' : 'Preview'}
            </Button>
            <Button
              type="submit"
              form="broadcast-form"
              disabled={busy || estimatedAudience === 0}
              leading={busy ? undefined : <Send size={14} />}
            >
              {busy ? 'Sending…' : `Send to ${estimatedAudience}`}
            </Button>
          </>
        )
      }
    >
      {isHandoff ? (
        // ── Handoff view ──────────────────────────────────────────────────────
        <div className="space-y-3">
          {sentRecipients.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5 dark:border-gray-800 dark:bg-gray-800/50">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Ready to send ({sentRecipients.length})
                </span>
                <span className="text-[10px] text-gray-400">
                  {openedIds.size}/{sentRecipients.length} opened
                </span>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {sentRecipients.map((r) => {
                  const opened = openedIds.has(r.trackingId);
                  return (
                    <li key={r.trackingId} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {r.managerName}
                        </div>
                        <div className="truncate text-[11px] text-gray-500">{r.managerEmail}</div>
                      </div>
                      <Button
                        type="button"
                        variant={opened ? 'secondary' : 'primary'}
                        leading={r.channel === 'teams' ? <MessageSquare size={13} /> : <Mail size={13} />}
                        onClick={() => {
                          if (!handoffOne(r)) {
                            toast(`Browser blocked the ${channelLabel} window — allow popups for this site.`, { icon: '⚠️' });
                          }
                        }}
                      >
                        {opened ? 'Re-open' : `Open ${channelLabel}`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
              No recipients had a valid email address — nothing to open.
            </div>
          )}
          {skippedRecipients.length + failedRecipients.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800/50">
                Not sent ({skippedRecipients.length + failedRecipients.length})
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {[...skippedRecipients, ...failedRecipients].map((r) => (
                  <li key={r.trackingId} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                    <span className="truncate text-gray-700 dark:text-gray-300">{r.managerName}</span>
                    <span className="shrink-0 text-gray-400">{r.state === 'skipped' ? 'Skipped' : 'Failed'} · {r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : view === 'preview' ? (
        // ── Preview view ──────────────────────────────────────────────────────
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:bg-gray-800/40">
            Preview for a representative recipient — tokens substituted per-manager at send time.
          </div>
          <PreviewPane subject={previewSubject} body={previewBody} deadlineAt={deadlineAt || null} />
        </div>
      ) : (
        // ── Compose view ──────────────────────────────────────────────────────
        <form id="broadcast-form" onSubmit={submit} className="space-y-4">

          {/* Audience banner */}
          <div className="flex items-center justify-between rounded-xl border border-brand/20 bg-brand/5 px-4 py-2.5 dark:bg-brand/10">
            <span className="text-sm text-brand dark:text-red-300">
              <strong>{estimatedAudience}</strong> manager{estimatedAudience === 1 ? '' : 's'} with open findings
            </span>
            <CycleIndicator channel={channel} />
          </div>

          {/* Channel + due date row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Channel</div>
              <ChannelToggle value={channel} onChange={handleChannelChange} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Due date
                <input
                  type="date"
                  value={deadlineAt}
                  onChange={(e) => setDeadlineAt(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
            </div>
          </div>

          {/* Function filter (if available) */}
          {functionOptions.length > 0 ? (
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Limit to function
              <select
                value={functionId}
                onChange={(e) => setFunctionId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">All functions</option>
                {functionOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </label>
          ) : null}

          {/* Template section */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Template</span>
              <PasteImport onImport={handlePasteImport} />
            </div>
            <TemplateStrip presets={presets} activeId={activePresetId} onSelect={handlePresetSelect} />

            <div className="mt-3 space-y-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Subject
                <input
                  value={subject}
                  onChange={(e) => { setSubject(e.target.value); setActivePresetId(null); }}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                  required
                />
              </label>

              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Body
                <textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setActivePresetId(null); }}
                  rows={channel === 'teams' ? 4 : 7}
                  required
                  className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed dark:border-gray-700 dark:bg-gray-900"
                />
                <span className="mt-1 block text-[10px] text-gray-400">
                  Tokens: <code>{'{{managerName}}'}</code> <code>{'{{projectCount}}'}</code>{' '}
                  <code>{'{{dueDate}}'}</code> <code>{'{{auditRunCode}}'}</code> — substituted per-recipient at send time.
                </span>
              </label>
            </div>
          </div>

          {/* Auditor note */}
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Auditor note
            <span className="ml-1 text-[10px] font-normal normal-case text-gray-400">(internal — not sent to recipients)</span>
            <textarea
              value={authorNote}
              onChange={(e) => setAuthorNote(e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
        </form>
      )}
    </Modal>
  );
}
