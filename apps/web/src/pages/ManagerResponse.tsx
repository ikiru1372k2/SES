import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { usePrompt } from '../components/shared/ConfirmProvider';

/**
 * Public response page loaded from a signed email link.
 *
 * Intentionally minimal:
 *   - No app shell, no auth context, no Zustand store. Just fetch, render,
 *     submit. Keeping this flow in its own component means a manager clicking
 *     the link never triggers the large client bundle of the authenticated
 *     app — faster first paint, lower CPU on old devices.
 *   - Three one-click actions if allowed: Acknowledge, Correct, Dispute.
 *   - Correct reveals inline fields for the three corrections we support
 *     (effort, state, manager reassignment).
 *   - After submit, the whole page becomes a confirmation; there is no
 *     navigation away, because the manager has no session.
 */

type ViewData = {
  linkCode: string;
  processCode: string;
  issueKey?: string;
  managerEmail: string;
  allowedActions: string[];
  expiresAt: string;
  issue?: {
    displayCode: string;
    projectNo?: string;
    projectName?: string;
    sheetName?: string;
    severity: string;
    effort?: number;
    reason?: string;
    projectState?: string;
  };
};

type ResponseAction = 'acknowledge' | 'correct' | 'dispute';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: ViewData }
  | { phase: 'rejected'; reason: string };

export function ManagerResponse() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ action: ResponseAction } | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ phase: 'rejected', reason: 'No response token provided.' });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/public/respond/${encodeURIComponent(token)}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: 'Unknown error' }));
          if (!cancelled) setState({ phase: 'rejected', reason: body.message ?? res.statusText });
          return;
        }
        const data = (await res.json()) as ViewData;
        if (!cancelled) setState({ phase: 'ready', data });
      } catch (err) {
        if (!cancelled) setState({ phase: 'rejected', reason: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(action: ResponseAction, body: Record<string, unknown> = {}) {
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/public/respond/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Could not submit response' }));
        toast.error(err.message ?? 'Could not submit response');
        return;
      }
      setDone({ action });
      toast.success('Thank you — your response was recorded.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <PageFrame>
        <p className="text-sm text-gray-500">Loading…</p>
      </PageFrame>
    );
  }

  if (state.phase === 'rejected') {
    return (
      <PageFrame>
        <h1 className="text-lg font-semibold text-gray-900">Link unavailable</h1>
        <p className="mt-2 text-sm text-gray-600">{state.reason}</p>
        <p className="mt-4 text-xs text-gray-400">
          If you believe this is an error, reply to the email you received and ask the auditor to
          reissue a fresh link.
        </p>
      </PageFrame>
    );
  }

  if (done) {
    return (
      <PageFrame>
        <h1 className="text-lg font-semibold text-gray-900">Thank you.</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your {done.action} has been recorded. You can close this page.
        </p>
        <p className="mt-4 text-xs text-gray-400">
          Reference: {state.data.linkCode} · {state.data.processCode}
        </p>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <ResponseCard
        data={state.data}
        submitting={submitting}
        onSubmit={submit}
      />
    </PageFrame>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function ResponseCard({
  data,
  submitting,
  onSubmit,
}: {
  data: ViewData;
  submitting: boolean;
  onSubmit: (action: ResponseAction, body?: Record<string, unknown>) => Promise<void>;
}) {
  const prompt = usePrompt();
  const [mode, setMode] = useState<'choose' | 'correct'>('choose');
  const canAck = data.allowedActions.includes('acknowledge');
  const canCorrect = data.allowedActions.includes('correct');
  const canDispute = data.allowedActions.includes('dispute');

  async function dispute() {
    const note = await prompt({
      title: 'Why are you disputing?',
      description: 'Optional — helps the auditor understand your reasoning.',
      placeholder: 'Reason this flag does not apply…',
      multiline: true,
      confirmLabel: 'Submit dispute',
    });
    if (note === null) return;
    const body = note.trim() ? { note: note.trim() } : {};
    await onSubmit('dispute', body);
  }

  return (
    <div>
      <div className="mb-4">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Ref: {data.linkCode}</p>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">
          {data.issue?.projectName ? `Review needed: ${data.issue.projectName}` : 'Audit response requested'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {data.processCode} · recipient: <span className="font-mono">{data.managerEmail}</span>
        </p>
      </div>

      {data.issue ? <IssueSummary issue={data.issue} /> : null}

      {mode === 'choose' ? (
        <div className="mt-5 space-y-2">
          {canAck ? (
            <ActionButton
              label="Acknowledge"
              description="Confirm the flagged item is accurate. No further action from you."
              onClick={() => onSubmit('acknowledge')}
              disabled={submitting}
              tone="primary"
            />
          ) : null}
          {canCorrect ? (
            <ActionButton
              label="Correct"
              description="The data is wrong. Tell us what the right value is."
              onClick={() => setMode('correct')}
              disabled={submitting}
              tone="neutral"
            />
          ) : null}
          {canDispute ? (
            <ActionButton
              label="Dispute"
              description="The flag doesn't apply here. An auditor will review."
              onClick={() => void dispute()}
              disabled={submitting}
              tone="neutral"
            />
          ) : null}
        </div>
      ) : (
        <CorrectionForm
          issue={data.issue}
          submitting={submitting}
          onCancel={() => setMode('choose')}
          onSubmit={(body) => onSubmit('correct', body)}
        />
      )}

      <p className="mt-6 text-[11px] text-gray-400">
        This link expires {new Date(data.expiresAt).toLocaleDateString()} and can be used once.
      </p>
    </div>
  );
}

function IssueSummary({ issue }: { issue: NonNullable<ViewData['issue']> }) {
  const severityColor = useMemo(() => {
    switch (issue.severity) {
      case 'High':
        return 'bg-rose-100 text-rose-800';
      case 'Medium':
        return 'bg-amber-100 text-amber-800';
      case 'Low':
        return 'bg-emerald-100 text-emerald-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }, [issue.severity]);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {issue.projectNo ? <div className="font-mono text-xs text-gray-500">{issue.projectNo}</div> : null}
          <div className="mt-0.5 font-medium text-gray-900">{issue.projectName ?? '(unnamed project)'}</div>
          {issue.sheetName ? <div className="text-xs text-gray-500">Sheet: {issue.sheetName}</div> : null}
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${severityColor}`}>
          {issue.severity}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
        {issue.effort != null ? (
          <div>
            <span className="font-semibold text-gray-700">Effort:</span> {issue.effort}h
          </div>
        ) : null}
        {issue.projectState ? (
          <div>
            <span className="font-semibold text-gray-700">State:</span> {issue.projectState}
          </div>
        ) : null}
      </div>
      {issue.reason ? <div className="mt-2 text-xs text-gray-600">{issue.reason}</div> : null}
    </div>
  );
}

function ActionButton({
  label,
  description,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
  tone: 'primary' | 'neutral';
}) {
  const toneClasses =
    tone === 'primary'
      ? 'border-brand bg-brand text-white hover:bg-brand/90 disabled:opacity-50'
      : 'border-gray-300 bg-white text-gray-900 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-lg border px-4 py-3 text-left transition ${toneClasses}`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className={`mt-0.5 text-xs ${tone === 'primary' ? 'text-white/90' : 'text-gray-500'}`}>
        {description}
      </div>
    </button>
  );
}

function CorrectionForm({
  issue,
  submitting,
  onCancel,
  onSubmit,
}: {
  issue: ViewData['issue'];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [effort, setEffort] = useState<string>(issue?.effort != null ? String(issue.effort) : '');
  const [state, setState] = useState<string>(issue?.projectState ?? '');
  const [manager, setManager] = useState<string>('');
  const [note, setNote] = useState<string>('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    if (effort.trim()) {
      const parsed = Number(effort);
      if (Number.isFinite(parsed)) body.correctedEffort = parsed;
    }
    if (state.trim()) body.correctedState = state.trim();
    if (manager.trim()) body.correctedManager = manager.trim();
    if (note.trim()) body.note = note.trim();
    onSubmit(body);
  }

  return (
    <form className="mt-5 space-y-3 text-sm" onSubmit={submit}>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">Correct effort (hours)</label>
        <input
          type="number"
          step="any"
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder={issue?.effort != null ? String(issue.effort) : 'e.g. 120'}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">Correct project state</label>
        <input
          type="text"
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder={issue?.projectState ?? 'e.g. On Hold'}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">Reassign manager</label>
        <input
          type="text"
          value={manager}
          onChange={(e) => setManager(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="someone@example.com"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">Note (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="Anything else the auditor should know?"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          Submit correction
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
        >
          Back
        </button>
      </div>
    </form>
  );
}
