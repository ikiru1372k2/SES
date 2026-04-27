import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { FUNCTION_IDS } from '@ses/domain';
import toast from 'react-hot-toast';
import { fetchEscalationTemplates } from '../../../lib/api/escalationTemplatesApi';
import {
  discardComposeDraft,
  fetchComposeStatus,
  previewCompose,
  saveComposeDraft,
  sendCompose,
  type ComposeDraftPayload,
} from '../../../lib/api/trackingComposeApi';
import { openMailto, openTeamsChat } from '../../../lib/outbound/clientHandoff';
import { useAutosaveOnLeave } from '../../../hooks/useAutosaveOnLeave';
import { useConfirm } from '../../shared/ConfirmProvider';

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
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export { stageKeyForRow, addBusinessDays, toDateInputValue };

export function useComposerState({
  processDisplayCode,
  row,
  trackingRef,
  onDone,
}: {
  processDisplayCode: string;
  row: ProcessEscalationManagerRow;
  trackingRef: string | undefined | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCc(defaultCc);
  }, [defaultCc, row.managerKey]);

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

  // Autosave-on-leave (Issue #74)
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

  return {
    // state
    viewMode,
    setViewMode,
    templateId,
    subject,
    setSubject,
    body,
    setBody,
    cc,
    ccInput,
    setCcInput,
    removedEngines,
    resolvedPreview,
    dirtyWarn,
    setDirtyWarn,
    previewLoading,
    authorNote,
    setAuthorNote,
    deadlineAt,
    setDeadlineAt,
    projectLinks,
    setProjectLinks,
    projectLinksOpen,
    setProjectLinksOpen,
    // derived
    uniqueProjectIds,
    cleanProjectLinks,
    outlookCount,
    teamsCount,
    outlookAllowed,
    teamsAllowed,
    outlookGateReason,
    teamsGateReason,
    readOnly,
    // queries
    statusQ,
    templatesQ,
    // mutations
    draftMut,
    discardMut,
    sendMut,
    // handlers
    payload,
    onTemplateChange,
    addCc,
    removeCc,
    toggleEngineRemove,
  };
}
