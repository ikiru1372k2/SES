import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_IDS } from '@ses/domain';
import toast from 'react-hot-toast';
import { Mail, MessageSquare } from 'lucide-react';
import { fetchEscalationTemplates } from '../../lib/api/escalationTemplatesApi';
import {
  discardComposeDraft,
  fetchComposeStatus,
  previewCompose,
  saveComposeDraft,
  sendCompose,
  type ComposeDraftPayload,
} from '../../lib/api/trackingComposeApi';
import { openMailto, openTeamsChat } from '../../lib/outbound/clientHandoff';
import { useAutosaveOnLeave } from '../../hooks/useAutosaveOnLeave';
import { Button } from '../shared/Button';
import { PreviewPane } from './PreviewPane';

type SendChannel = 'email' | 'teams';

function stageKeyForRow(row: ProcessEscalationManagerRow): string {
  const lv = row.escalationLevel ?? 0;
  if (lv >= 2) return 'ESCALATED_L2';
  if (lv >= 1) return 'ESCALATED_L1';
  return 'NEW';
}

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
  // yyyy-mm-dd for <input type="date">
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function Composer({
  processDisplayCode,
  row,
  onDone,
}: {
  processDisplayCode: string;
  row: ProcessEscalationManagerRow;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const trackingRef = row.trackingId ?? row.trackingDisplayCode;

  // Issue #75 — Composer defaults to Preview so the auditor reviews before
  // sending. Edit is a toggle-back; send actions live in the preview footer.
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [removedEngines, setRemovedEngines] = useState<Set<string>>(new Set());
  const [resolvedPreview, setResolvedPreview] = useState<{ subject: string; body: string } | null>(null);
  const [dirtyWarn, setDirtyWarn] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [authorNote, setAuthorNote] = useState('');
  const [deadlineAt, setDeadlineAt] = useState<string>(() =>
    toDateInputValue(addBusinessDays(new Date(), 5)),
  );

  const outlookCount = row.outlookCount ?? 0;
  const teamsCount = row.teamsCount ?? 0;
  const outlookAllowed = outlookCount < 2;
  const teamsAllowed = outlookCount >= 2 && teamsCount < 1;
  const cycleComplete = outlookCount >= 2 && teamsCount >= 1;

  const statusQ = useQuery({
    queryKey: ['compose-status', trackingRef],
    queryFn: () => fetchComposeStatus(trackingRef!),
    enabled: Boolean(trackingRef),
    refetchInterval: 30_000,
  });

  const templatesQ = useQuery({
    queryKey: ['escalation-templates', stageKeyForRow(row)],
    queryFn: () => fetchEscalationTemplates({ stageKey: stageKeyForRow(row) }),
    enabled: Boolean(processDisplayCode),
  });

  const locked = statusQ.data?.locked === true;
  const readOnly = locked;

  const defaultCc = useMemo(() => {
    const lv = row.escalationLevel ?? 0;
    if (lv >= 2) return ['stakeholder@example.com'];
    if (lv >= 1) return ['manager-manager@example.com'];
    return [];
  }, [row.escalationLevel]);

  // Initialise CC from the escalation level when the selected manager changes
  // (a different manager often means different stakeholders). Deliberate
  // derived-state-on-external-change pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCc(defaultCc);
  }, [defaultCc, row.managerKey]);

  // Preselect the first template once templates finish loading — the
  // dropdown is initialised from server data, not derivable at mount time.
  useEffect(() => {
    const t = templatesQ.data?.[0];
    if (!t) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTemplateId(t.id);
    setSubject(t.subject);
    setBody(t.body);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [templatesQ.data]);

  // Refresh the resolved preview whenever we enter preview mode so the
  // auditor sees the actual substituted copy, not the raw template.
  useEffect(() => {
    if (viewMode !== 'preview' || !trackingRef) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewLoading(true);
    const previewBody: Partial<ComposeDraftPayload> = {
      subject,
      body,
      cc,
      removedEngineIds: [...removedEngines],
      authorNote,
      deadlineAt: deadlineAt || null,
    };
    if (templateId) previewBody.templateId = templateId;
    void previewCompose(trackingRef, previewBody)
      .then((data) => {
        if (cancelled) return;
        setResolvedPreview(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : 'Preview failed');
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, trackingRef, templateId, subject, body, cc, removedEngines, authorNote, deadlineAt]);

  const draftMut = useMutation({
    mutationFn: (payload: ComposeDraftPayload) => saveComposeDraft(trackingRef!, payload),
    onSuccess: () => {
      toast.success('Draft saved');
      void qc.invalidateQueries({ queryKey: ['escalations'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const discardMut = useMutation({
    mutationFn: () => discardComposeDraft(trackingRef!),
    onSuccess: () => {
      toast.success('Discarded');
      void qc.invalidateQueries({ queryKey: ['escalations'] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMut = useMutation({
    mutationFn: (channel: SendChannel) =>
      sendCompose(trackingRef!, {
        subject,
        body,
        cc,
        removedEngineIds: [...removedEngines],
        channel,
        authorNote,
        deadlineAt: deadlineAt || null,
        sources: FUNCTION_IDS.filter(
          (id) => (row.countsByEngine[id] ?? 0) > 0 && !removedEngines.has(id),
        ) as string[],
        ...(templateId ? { templateId } : {}),
      }),
    onSuccess: (result) => {
      // Issue #75: the server only records intent; the user's own app does
      // the actual send. Try to open it; fall back to a copy-hint when the
      // browser's popup blocker kills the window.open.
      const handoffOk =
        result.channel === 'teams'
          ? openTeamsChat({ to: result.to, message: `${result.subject}\n\n${result.body}` })
          : openMailto({ to: result.to, cc: result.cc, subject: result.subject, body: result.body });
      if (handoffOk) {
        toast.success(
          result.channel === 'teams' ? 'Recorded — Teams opening…' : 'Recorded — mail client opening…',
        );
      } else {
        toast(
          `Recorded on server. Your browser blocked the ${result.channel === 'teams' ? 'Teams' : 'mail'} window — open it manually.`,
          { icon: '⚠️' },
        );
      }
      void qc.invalidateQueries({ queryKey: ['escalations'] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Autosave-on-leave (Issue #74): silent flush of whatever the auditor has
  // typed so far when the tab is hidden, the window unloads, or the route
  // changes. Only fires when something has actually been edited (dirtyRef),
  // and never when the drawer is read-only / locked by another user.
  //
  // Hooks MUST be called unconditionally and before any early return — the
  // `readOnly` / `trackingRef` guards live inside the callback itself.
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = true;
  }, [subject, body, cc, removedEngines, templateId, authorNote, deadlineAt]);
  const latestPayloadRef = useRef<ComposeDraftPayload>({
    subject,
    body,
    cc,
    removedEngineIds: [...removedEngines],
    authorNote,
    deadlineAt: deadlineAt || null,
    ...(templateId ? { templateId } : {}),
  });
  useEffect(() => {
    latestPayloadRef.current = {
      subject,
      body,
      cc,
      removedEngineIds: [...removedEngines],
      authorNote,
      deadlineAt: deadlineAt || null,
      ...(templateId ? { templateId } : {}),
    };
  }, [subject, body, cc, removedEngines, templateId, authorNote, deadlineAt]);
  useAutosaveOnLeave(async () => {
    if (readOnly || !trackingRef || !dirtyRef.current) return;
    if (!latestPayloadRef.current.body?.trim() && !latestPayloadRef.current.subject?.trim()) return;
    try {
      await saveComposeDraft(trackingRef, latestPayloadRef.current);
      dirtyRef.current = false;
    } catch {
      // Autosave is best-effort — never interrupt the user's navigation.
    }
  }, Boolean(trackingRef));

  if (!trackingRef) {
    return <p className="text-sm text-amber-700">No tracking row yet — save tracking from the workspace first.</p>;
  }

  function onTemplateChange(id: string) {
    if (body.trim() && templateId && id !== templateId) {
      setDirtyWarn(true);
      return;
    }
    setDirtyWarn(false);
    setTemplateId(id);
    const t = templatesQ.data?.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  }

  function addCc() {
    const v = ccInput.trim();
    if (!v || cc.includes(v)) return;
    setCc([...cc, v]);
    setCcInput('');
  }

  function removeCc(email: string) {
    if (!window.confirm('Remove this CC recipient? They may miss important context.')) return;
    setCc(cc.filter((c) => c !== email));
  }

  function toggleEngineRemove(fid: FunctionId, count: number) {
    if (!removedEngines.has(fid)) {
      if (!window.confirm(`Remove ${fid} section? ${count} finding(s) still open in tracking.`)) return;
      setRemovedEngines(new Set([...removedEngines, fid]));
    } else {
      const n = new Set(removedEngines);
      n.delete(fid);
      setRemovedEngines(n);
    }
  }

  const payload: ComposeDraftPayload = {
    subject,
    body,
    cc,
    removedEngineIds: [...removedEngines],
    authorNote,
    deadlineAt: deadlineAt || null,
    ...(templateId ? { templateId } : {}),
  };

  const outlookGateReason = cycleComplete
    ? 'Cycle complete — resolve or force re-escalate.'
    : outlookAllowed
    ? ''
    : 'Outlook limit reached — escalate via Teams next.';
  const teamsGateReason = cycleComplete
    ? 'Cycle complete — resolve or force re-escalate.'
    : teamsAllowed
    ? ''
    : outlookCount < 2
    ? `Send ${2 - outlookCount} more Outlook reminder${2 - outlookCount === 1 ? '' : 's'} before Teams.`
    : 'Teams already used this cycle.';

  return (
    <div className="space-y-4">
      {readOnly ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Being edited by {statusQ.data?.lockedBy ?? 'another user'} until {statusQ.data?.lockedUntil ? new Date(statusQ.data.lockedUntil).toLocaleString() : '—'}
        </div>
      ) : null}
      {dirtyWarn ? (
        <div className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950">
          <span>You edited the body. Changing template will replace content.</span>
          <button type="button" className="text-brand underline" onClick={() => setDirtyWarn(false)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-medium">Ladder:</span>
        <span className={`rounded-full px-2 py-0.5 ${outlookCount >= 1 ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-800'}`}>
          Outlook #1 {outlookCount >= 1 ? '✓' : ''}
        </span>
        <span className={`rounded-full px-2 py-0.5 ${outlookCount >= 2 ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-800'}`}>
          Outlook #2 {outlookCount >= 2 ? '✓' : ''}
        </span>
        <span className={`rounded-full px-2 py-0.5 ${teamsCount >= 1 ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-800'}`}>
          Teams {teamsCount >= 1 ? '✓' : ''}
        </span>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-500">To</div>
        <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
          {row.managerName} &lt;{row.resolvedEmail ?? '—'}&gt;
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-500">CC</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {cc.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
              {c}
              {!readOnly ? (
                <button type="button" className="text-gray-500 hover:text-red-600" onClick={() => removeCc(c)} aria-label={`Remove ${c}`}>
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {!readOnly ? (
          <div className="mt-2 flex gap-2">
            <input
              value={ccInput}
              onChange={(e) => setCcInput(e.target.value)}
              placeholder="email@company.com"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
            <Button type="button" variant="secondary" onClick={addCc}>
              Add
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-gray-500">Template</label>
          <select
            disabled={readOnly}
            value={templateId ?? ''}
            onChange={(e) => onTemplateChange(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
          >
            {(templatesQ.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.stage} v{t.version} ({t.channel})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Due date (shown to manager as {'{{dueDate}}'})</label>
          <input
            type="date"
            disabled={readOnly}
            value={deadlineAt}
            onChange={(e) => setDeadlineAt(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-500">Findings by engine</div>
        <div className="mt-1 space-y-1">
          {FUNCTION_IDS.map((fid) => {
            const n = row.countsByEngine[fid] ?? 0;
            if (n === 0) return null;
            const open = !removedEngines.has(fid);
            return (
              <details key={fid} open={open} className="rounded border border-gray-200 dark:border-gray-700">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium">
                  {fid} ({n})
                  {!readOnly ? (
                    <button
                      type="button"
                      className="ml-2 text-red-600 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleEngineRemove(fid, n);
                      }}
                    >
                      {open ? 'Remove' : 'Restore'}
                    </button>
                  ) : null}
                </summary>
                <ul className="border-t border-gray-100 px-2 py-1 text-xs dark:border-gray-800">
                  {(row.findingsByEngine[fid] ?? []).map((f) => (
                    <li key={f.issueKey}>{f.projectNo ?? f.issueKey}</li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </div>

      {viewMode === 'edit' ? (
        <>
          <div>
            <label className="text-xs font-medium text-gray-500">Subject</label>
            <input
              disabled={readOnly}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">Body (markdown)</label>
            <textarea
              disabled={readOnly}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">
            Preview (what the manager will see)
          </div>
          <PreviewPane
            subject={resolvedPreview?.subject ?? (previewLoading ? 'Loading…' : subject)}
            body={resolvedPreview?.body ?? (previewLoading ? 'Loading…' : body)}
          />
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-gray-500">
          Auditor note (internal — not shown to the manager)
        </label>
        <textarea
          disabled={readOnly}
          value={authorNote}
          onChange={(e) => setAuthorNote(e.target.value)}
          rows={2}
          placeholder="Why are you sending this now? e.g. 'tried calling twice, no answer'"
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setViewMode(viewMode === 'preview' ? 'edit' : 'preview')}
        >
          {viewMode === 'preview' ? 'Edit' : 'Preview'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => discardMut.mutate()} disabled={readOnly || discardMut.isPending}>
          Discard
        </Button>
        <Button type="button" variant="secondary" onClick={() => draftMut.mutate(payload)} disabled={readOnly || draftMut.isPending}>
          Save draft
        </Button>
        <div className="flex-1" />
        <Button
          type="button"
          variant={outlookAllowed ? 'primary' : 'secondary'}
          leading={<Mail size={14} />}
          title={outlookGateReason || 'Open Outlook with this message prefilled'}
          disabled={readOnly || !outlookAllowed || sendMut.isPending}
          onClick={() => sendMut.mutate('email')}
        >
          Outlook ({outlookCount}/2)
        </Button>
        <Button
          type="button"
          variant={teamsAllowed ? 'primary' : 'secondary'}
          leading={<MessageSquare size={14} />}
          title={teamsGateReason || 'Open Teams chat with this message prefilled'}
          disabled={readOnly || !teamsAllowed || sendMut.isPending}
          onClick={() => sendMut.mutate('teams')}
        >
          Teams ({teamsCount}/1)
        </Button>
      </div>
    </div>
  );
}
