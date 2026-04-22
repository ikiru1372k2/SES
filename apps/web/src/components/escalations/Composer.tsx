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
import { useAutosaveOnLeave } from '../../hooks/useAutosaveOnLeave';
import { Button } from '../shared/Button';
import { PreviewPane } from './PreviewPane';

function stageKeyForRow(row: ProcessEscalationManagerRow): string {
  const lv = row.escalationLevel ?? 0;
  if (lv >= 2) return 'ESCALATED_L2';
  if (lv >= 1) return 'ESCALATED_L1';
  return 'NEW';
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
  const [previewMode, setPreviewMode] = useState(false);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [channel, setChannel] = useState<'email' | 'teams' | 'both'>('email');
  const [removedEngines, setRemovedEngines] = useState<Set<string>>(new Set());
  const [resolvedPreview, setResolvedPreview] = useState<{ subject: string; body: string } | null>(null);
  const [dirtyWarn, setDirtyWarn] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  useEffect(() => {
    setCc(defaultCc);
  }, [defaultCc, row.managerKey]);

  useEffect(() => {
    const t = templatesQ.data?.[0];
    if (!t) return;
    setTemplateId(t.id);
    setSubject(t.subject);
    setBody(t.body);
    setChannel((t.channel as 'email' | 'teams' | 'both') || 'email');
  }, [templatesQ.data]);

  async function togglePreview() {
    if (previewMode) {
      setPreviewMode(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const previewBody: Partial<ComposeDraftPayload> = {
        subject,
        body,
        cc,
        removedEngineIds: [...removedEngines],
        channel,
      };
      if (templateId) previewBody.templateId = templateId;
      const data = await previewCompose(trackingRef!, previewBody);
      setResolvedPreview(data);
      setPreviewMode(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }

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
    mutationFn: () =>
      sendCompose(trackingRef!, {
        subject,
        body,
        cc,
        removedEngineIds: [...removedEngines],
        channel,
        sources: FUNCTION_IDS.filter((id) => (row.countsByEngine[id] ?? 0) > 0 && !removedEngines.has(id)) as string[],
        ...(templateId ? { templateId } : {}),
      }),
    onSuccess: () => {
      toast.success('Sent');
      void qc.invalidateQueries({ queryKey: ['escalations'] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
      setChannel((t.channel as 'email' | 'teams' | 'both') || 'email');
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
    channel,
    ...(templateId ? { templateId } : {}),
  };

  // Autosave-on-leave (Issue #74): silent flush of whatever the auditor has
  // typed so far when the tab is hidden, the window unloads, or the route
  // changes. Only fires when something has actually been edited (dirtyRef),
  // and never when the drawer is read-only / locked by another user.
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = true;
  }, [subject, body, cc, removedEngines, channel, templateId]);
  const latestPayloadRef = useRef(payload);
  latestPayloadRef.current = payload;
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
        <label className="text-xs font-medium text-gray-500">Channel</label>
        <select
          disabled={readOnly}
          value={channel}
          onChange={(e) => setChannel(e.target.value as 'email' | 'teams' | 'both')}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        >
          <option value="email">Email</option>
          <option value="teams">Teams</option>
          <option value="both">Both</option>
        </select>
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

      {!previewMode ? (
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
        <PreviewPane subject={resolvedPreview?.subject ?? ''} body={resolvedPreview?.body ?? ''} />
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
        <Button type="button" variant="secondary" onClick={() => void togglePreview()} disabled={previewLoading}>
          {previewMode ? 'Edit' : 'Preview'}
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="secondary" onClick={() => discardMut.mutate()} disabled={readOnly || discardMut.isPending}>
          Discard
        </Button>
        <Button type="button" variant="secondary" onClick={() => draftMut.mutate(payload)} disabled={readOnly || draftMut.isPending}>
          Save draft
        </Button>
        <Button type="button" onClick={() => sendMut.mutate()} disabled={readOnly || sendMut.isPending}>
          Send
        </Button>
      </div>
    </div>
  );
}
