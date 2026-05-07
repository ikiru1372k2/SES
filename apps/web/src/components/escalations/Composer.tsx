import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_IDS } from '@ses/domain';
import toast from 'react-hot-toast';
import { fetchEscalationTemplates } from '../../lib/api/escalationTemplatesApi';
import {
  discardComposeDraft,
  fetchComposeStatus,
  previewCompose,
  saveComposeDraft,
  sendCompose,
  type ComposeDraftPayload,
} from '../../lib/api/trackingComposeApi';
import { fillEmailPreviewWindow, fillEmailWindow, fillLoadingWindow, openBlankWindow } from '../../lib/outbound/clientHandoff';
import { useAutosaveOnLeave } from '../../hooks/useAutosaveOnLeave';
import { Button } from '../shared/Button';
import { useConfirm } from '../shared/ConfirmProvider';
import { PreviewPane } from './PreviewPane';
import { effectiveManagerEmail } from './nextAction';
import { ComposerActions } from './ComposerActions';
import { FindingsByEngineSection, ProjectLinksSection } from './ComposerSubsections';

type SendChannel = 'email' | 'teams';

function stageKeyForRow(row: ProcessEscalationManagerRow): string {
  if (row.stage === 'AWAITING_RESPONSE' || row.stage === 'NO_RESPONSE') return 'AWAITING_RESPONSE';
  if (row.stage === 'ESCALATED_L2') return 'ESCALATED_L2';
  if (row.stage === 'ESCALATED_L1') return 'ESCALATED_L1';
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
  const confirm = useConfirm();
  const trackingRef = row.trackingId ?? row.trackingDisplayCode;
  const managerEmail = effectiveManagerEmail(row);

  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [removedEngines, setRemovedEngines] = useState<Set<string>>(new Set());
  const [resolvedPreview, setResolvedPreview] = useState<{
    subject: string;
    body: string;
    bodyHtml?: string;
  } | null>(null);
  const [dirtyWarn, setDirtyWarn] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [authorNote, setAuthorNote] = useState('');
  const [deadlineAt, setDeadlineAt] = useState<string>(() =>
    toDateInputValue(addBusinessDays(new Date(), 5)),
  );
  const [projectLinks, setProjectLinks] = useState<Record<string, string>>({});
  const [projectLinksOpen, setProjectLinksOpen] = useState(false);

  const uniqueProjectIds = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const fid of FUNCTION_IDS) {
      for (const f of row.findingsByEngine[fid] ?? []) {
        const id = f.projectNo?.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ordered.push(id);
      }
    }
    return ordered;
  }, [row.findingsByEngine]);

  const cleanProjectLinks = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [pid, url] of Object.entries(projectLinks)) {
      const trimmed = url.trim();
      if (!trimmed) continue;
      if (!/^https?:\/\//i.test(trimmed)) continue;
      out[pid] = trimmed;
    }
    return out;
  }, [projectLinks]);

  const outlookCount = row.outlookCount ?? 0;
  const teamsCount = row.teamsCount ?? 0;

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

  useEffect(() => {
    setCc([]);
  }, [row.managerKey]);

  useEffect(() => {
    const t = templatesQ.data?.[0];
    if (!t) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTemplateId(t.id);
    setSubject(t.subject);
    setBody(t.body);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [templatesQ.data]);

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
      projectLinks: cleanProjectLinks,
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
  }, [viewMode, trackingRef, templateId, subject, body, cc, removedEngines, authorNote, deadlineAt, cleanProjectLinks]);

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

  const handoffWindowRef = useRef<Window | null>(null);

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
        projectLinks: cleanProjectLinks,
        sources: FUNCTION_IDS.filter(
          (id) => (row.countsByEngine[id] ?? 0) > 0 && !removedEngines.has(id),
        ) as string[],
        ...(templateId ? { templateId } : {}),
      }),
    onSuccess: (result) => {
      const win = handoffWindowRef.current;
      handoffWindowRef.current = null;
      if (result.channel === 'teams') {
        // Teams: just update the window location to the deep-link.
        if (win && !win.closed) {
          const msg = `${result.subject}\n\n${result.body}`;
          const url =
            `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(result.to)}` +
            `&message=${encodeURIComponent(msg.length > 4000 ? msg.slice(0, 4000) : msg)}`;
          win.location.href = url;
        }
        toast.success('Recorded — Teams opening…');
      } else {
        if (!win || win.closed) {
          toast.error('Allow popups before recording an Outlook send.');
          return;
        }
        fillEmailWindow(win, {
          to: result.to,
          cc: result.cc,
          subject: result.subject,
          body: result.body,
          bodyHtml: result.bodyHtml,
        });
        toast.success('Recorded — use the handoff page to open Outlook with formatted body.');
      }
      void qc.invalidateQueries({ queryKey: ['escalations'] });
      onDone();
    },
    onError: (e: Error) => {
      // Close the loading window on error.
      if (handoffWindowRef.current && !handoffWindowRef.current.closed) {
        handoffWindowRef.current.close();
        handoffWindowRef.current = null;
      }
      toast.error(e.message);
    },
  });

  const [previewPopupPending, setPreviewPopupPending] = useState(false);
  function openPreviewPopup() {
    if (!trackingRef) return;
    const win = openBlankWindow();
    if (!win) { toast('Allow popups to preview the email.', { icon: '⚠️' }); return; }
    fillLoadingWindow(win);
    setPreviewPopupPending(true);
    void previewCompose(trackingRef, {
      subject, body, cc,
      removedEngineIds: [...removedEngines],
      authorNote,
      deadlineAt: deadlineAt || null,
      projectLinks: cleanProjectLinks,
      ...(templateId ? { templateId } : {}),
    }).then((data) => {
      if (!win.closed) {
        fillEmailPreviewWindow(win, {
          to: effectiveManagerEmail(row) ?? '',
          cc,
          subject: data.subject,
          body: data.body,
          bodyHtml: data.bodyHtml,
        });
      }
    }).catch((e: unknown) => {
      if (!win.closed) win.close();
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    }).finally(() => setPreviewPopupPending(false));
  }

  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = true;
  }, [subject, body, cc, removedEngines, templateId, authorNote, deadlineAt, cleanProjectLinks]);
  const latestPayloadRef = useRef<ComposeDraftPayload>({
    subject,
    body,
    cc,
    removedEngineIds: [...removedEngines],
    authorNote,
    deadlineAt: deadlineAt || null,
    projectLinks: cleanProjectLinks,
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
      projectLinks: cleanProjectLinks,
      ...(templateId ? { templateId } : {}),
    };
  }, [subject, body, cc, removedEngines, templateId, authorNote, deadlineAt, cleanProjectLinks]);
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

  async function removeCc(email: string) {
    const ok = await confirm({
      title: `Remove ${email} from CC?`,
      description: 'They may miss important context.',
      confirmLabel: 'Remove',
      tone: 'destructive',
    });
    if (!ok) return;
    setCc(cc.filter((c) => c !== email));
  }

  async function toggleEngineRemove(fid: FunctionId, count: number) {
    if (!removedEngines.has(fid)) {
      const ok = await confirm({
        title: `Remove ${fid} section?`,
        description: `${count} finding${count === 1 ? '' : 's'} still open in tracking.`,
        confirmLabel: 'Remove',
        tone: 'destructive',
      });
      if (!ok) return;
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
    projectLinks: cleanProjectLinks,
    ...(templateId ? { templateId } : {}),
  };

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

      <div>
        <div className="text-xs font-medium text-gray-500">To</div>
        <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
          {row.managerName} &lt;{managerEmail ?? '—'}&gt;
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-500">CC</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {cc.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
              {c}
              {!readOnly ? (
                <button type="button" className="text-gray-500 hover:text-red-600" onClick={() => void removeCc(c)} aria-label={`Remove ${c}`}>
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

      <ProjectLinksSection
        uniqueProjectIds={uniqueProjectIds}
        cleanProjectLinks={cleanProjectLinks}
        projectLinks={projectLinks}
        projectLinksOpen={projectLinksOpen}
        readOnly={readOnly}
        setProjectLinks={setProjectLinks}
        setProjectLinksOpen={setProjectLinksOpen}
      />

      <FindingsByEngineSection
        row={row}
        readOnly={readOnly}
        removedEngines={removedEngines}
        onToggleEngine={(fid, count) => void toggleEngineRemove(fid, count)}
      />

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
            {...(resolvedPreview?.bodyHtml ? { bodyHtml: resolvedPreview.bodyHtml } : {})}
            deadlineAt={deadlineAt || null}
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

      <ComposerActions
        readOnly={readOnly}
        viewMode={viewMode}
        onToggleView={() => setViewMode(viewMode === 'preview' ? 'edit' : 'preview')}
        onDiscard={() => discardMut.mutate()}
        discardPending={discardMut.isPending}
        onSave={() => draftMut.mutate(payload)}
        draftPending={draftMut.isPending}
        onPreview={() => void openPreviewPopup()}
        previewPending={previewPopupPending}
        outlookAllowed={true}
        outlookGateReason=""
        outlookCount={outlookCount}
        onOutlook={() => {
          const win = openBlankWindow();
          if (!win) { toast.error('Allow popups before recording an Outlook send.'); return; }
          fillLoadingWindow(win);
          handoffWindowRef.current = win;
          sendMut.mutate('email');
        }}
        teamsAllowed={true}
        teamsGateReason=""
        teamsCount={teamsCount}
        onTeams={() => {
          const win = openBlankWindow();
          if (!win) { toast.error('Allow popups before recording a Teams send.'); return; }
          fillLoadingWindow(win);
          handoffWindowRef.current = win;
          sendMut.mutate('teams');
        }}
        sendPending={sendMut.isPending}
      />
    </div>
  );
}
