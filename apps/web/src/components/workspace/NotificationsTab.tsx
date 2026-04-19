import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  buildNotificationDrafts,
  defaultTemplateForTheme,
  downloadEml,
  notificationPlainText,
  openMailDraft,
  openTeamsMessage,
} from '../../lib/notificationBuilder';
import { recordSendOnApi } from '../../lib/api/notificationsApi';
import { createSignedLink } from '../../lib/api/signedLinksApi';
import type { AuditProcess, AuditResult, NotificationDraft, NotificationTemplate, NotificationTheme } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { EmptyState } from '../shared/EmptyState';
import { BroadcastComposer } from './notifications/BroadcastComposer';
import { PerManagerDrafts } from './notifications/PerManagerDrafts';
import { SendLogPanel } from './SendLogPanel';

const DEFAULT_BROADCAST_SUBJECT = 'QGC audit cycle summary';
const DEFAULT_BROADCAST_BODY = [
  'Dear Project Managers,',
  '',
  'The latest QGC workbook audit has identified items that require your attention. Please review your flagged projects in the attached workbook and update effort planning before the next escalation review.',
  '',
  'Thank you,',
  'Effort Audit Team',
].join('\n');

export function NotificationsTab({ process, result }: { process: AuditProcess; result: AuditResult | null }) {
  const recordTrackingEvent = useAppStore((state) => state.recordTrackingEvent);
  const saveTemplate = useAppStore((state) => state.saveTemplate);
  const [mode, setMode] = useState<'broadcast' | 'perManager'>('broadcast');
  const [theme, setTheme] = useState<NotificationTheme>('Company Reminder');
  const [deadline, setDeadline] = useState('');
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  const [selected, setSelected] = useState(0);
  const [broadcastSubject, setBroadcastSubject] = useState(DEFAULT_BROADCAST_SUBJECT);
  const [broadcastBody, setBroadcastBody] = useState(DEFAULT_BROADCAST_BODY);
  const [includeSignedLink, setIncludeSignedLink] = useState(false);
  const [template, setTemplate] = useState<NotificationTemplate>({
    greeting: 'Dear',
    deadlineLine: 'by',
    ...defaultTemplateForTheme('Company Reminder'),
  });

  const drafts = useMemo(
    () =>
      buildNotificationDrafts({
        issues: result?.issues ?? [],
        theme,
        deadline,
        template,
        corrections: process.corrections,
        comments: process.comments,
        acknowledgments: process.acknowledgments ?? {},
      }),
    [process.corrections, process.comments, process.acknowledgments, result, theme, deadline, template],
  );

  const visibleDrafts = useMemo(
    () => {
      const needle = managerSearch.trim().toLowerCase();
      return drafts
        .filter((draft) => (onlyUnreviewed ? draft.unreviewedCount > 0 : true))
        .filter((draft) => {
          if (!needle) return true;
          const projectText = draft.projects
            .map((project) => `${project.projectNo} ${project.projectName} ${project.projectManager} ${project.sheetName}`)
            .join(' ');
          return `${draft.pmName} ${draft.email ?? ''} ${draft.recipientKey} ${projectText}`.toLowerCase().includes(needle);
        });
    },
    [drafts, onlyUnreviewed, managerSearch],
  );
  // Reset selected to 0 when any filter changes (render-time state adjustment,
  // avoids the extra re-render cycle caused by an equivalent useEffect).
  const filterKey = `${managerSearch}|${String(onlyUnreviewed)}|${theme}|${deadline}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setSelected(0);
  }

  const active = visibleDrafts[selected] ?? visibleDrafts[0];
  const validRecipientCount = visibleDrafts.filter((draft) => draft.email).length;

  function track(draft: NotificationDraft, channel: 'outlook' | 'eml' | 'teams' | 'sendAll', note: string) {
    recordTrackingEvent(process.id, draft.pmName, draft.recipientKey, draft.issueCount, channel, note);
  }

  function worstSeverity(draft: NotificationDraft): 'High' | 'Medium' | 'Low' | undefined {
    const severities = draft.projects.map((p) => p.severity);
    if (severities.includes('High')) return 'High';
    if (severities.includes('Medium')) return 'Medium';
    if (severities.includes('Low')) return 'Low';
    return undefined;
  }

  function recordSend(draft: NotificationDraft, channel: 'outlook' | 'teams' | 'eml') {
    if (!process.serverBacked || !process.displayCode || !draft.email) return;
    const bodyPreview = notificationPlainText(draft).slice(0, 500);
    const severity = worstSeverity(draft);
    void recordSendOnApi(process.displayCode, {
      managerEmail: draft.email,
      managerName: draft.pmName,
      channel,
      subject: draft.subject,
      bodyPreview,
      issueCount: draft.issueCount,
      ...(severity !== undefined ? { severity } : {}),
    }).catch((err: unknown) => {
      console.warn('[notifications] record send failed', err);
    });
  }

  function copyDraft(draft: NotificationDraft) {
    void navigator.clipboard.writeText(notificationPlainText(draft));
    toast.success('Draft copied');
  }

  async function openOutlook(draft: NotificationDraft) {
    if (!draft.email) {
      toast.error('Add a project manager email in the workbook before opening Outlook');
      return;
    }
    let body = notificationPlainText(draft);
    if (includeSignedLink && process.serverBacked && process.displayCode) {
      try {
        const link = await createSignedLink(process.displayCode, {
          managerEmail: draft.email,
          managerName: draft.pmName,
          expiresInDays: 7,
        });
        const amended = `${body}\n\nRespond here without signing in: ${link.url}`;
        if (encodeURIComponent(amended).length > 1800) {
          try {
            await navigator.clipboard.writeText(link.url);
            toast('URL too long for Outlook — signed link copied to clipboard instead', { icon: '🔗' });
          } catch {
            toast(`Signed link: ${link.url}`, { icon: '🔗', duration: 8000 });
          }
        } else {
          body = amended;
        }
      } catch (err: unknown) {
        console.warn('[signed-link] embed failed', err);
      }
    }
    openMailDraft([draft.email], draft.subject, body);
    track(draft, 'outlook', 'Opened Outlook mail draft');
    recordSend(draft, 'outlook');
  }

  function downloadDraft(draft: NotificationDraft) {
    if (!draft.email) {
      toast.error('Add a project manager email in the workbook before downloading .eml');
      return;
    }
    downloadEml(draft);
    track(draft, 'eml', 'Downloaded .eml draft');
    recordSend(draft, 'eml');
    toast.success('Draft downloaded and tracking updated');
  }

  function openTeams(draft: NotificationDraft) {
    if (!draft.email) {
      toast.error('Add a project manager email in the workbook before opening Teams');
      return;
    }
    openTeamsMessage(draft.email, notificationPlainText(draft));
    track(draft, 'teams', 'Opened Teams escalation');
    recordSend(draft, 'teams');
  }

  function sendAll() {
    if (!visibleDrafts.length) return;
    const recipients = [...new Set(visibleDrafts.map((draft) => draft.email).filter((email): email is string => Boolean(email)))];
    if (!recipients.length) {
      toast.error('No valid manager emails found in the visible drafts');
      return;
    }
    const body = visibleDrafts.map((draft) => notificationPlainText(draft)).join('\n\n---\n\n');
    openMailDraft(recipients, `${theme}: audit summary`, body);
    visibleDrafts.filter((draft) => draft.email).forEach((draft) => {
      track(draft, 'sendAll', 'Included in Send All');
      recordSend(draft, 'outlook');
    });
    toast.success(`Draft opened for ${recipients.length} manager(s)`);
  }

  if (!result) {
    return (
      <div className="p-5">
        <EmptyState title="No notification drafts yet">
          Run an audit first to group flagged projects by project manager.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-5">
      <div className="mb-4 flex shrink-0 gap-1 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setMode('broadcast')}
          className={`border-b-2 px-4 py-2 text-sm font-medium ${
            mode === 'broadcast' ? 'border-brand text-brand' : 'border-transparent text-gray-500'
          }`}
        >
          Global broadcast
        </button>
        <button
          type="button"
          onClick={() => setMode('perManager')}
          className={`border-b-2 px-4 py-2 text-sm font-medium ${
            mode === 'perManager' ? 'border-brand text-brand' : 'border-transparent text-gray-500'
          }`}
        >
          Per-manager drafts
        </button>
      </div>
      {mode === 'perManager' && process.serverBacked && process.displayCode ? (
        <label className="mb-3 flex shrink-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={includeSignedLink}
            onChange={(e) => setIncludeSignedLink(e.target.checked)}
            className="rounded"
          />
          Include self-service link in Outlook drafts
        </label>
      ) : null}
      {mode === 'broadcast' ? (
        <BroadcastComposer
          drafts={drafts}
          subject={broadcastSubject}
          body={broadcastBody}
          onSubjectChange={setBroadcastSubject}
          onBodyChange={setBroadcastBody}
          onSend={(recipients, subject, body) => {
            openMailDraft(recipients, subject, body);
            drafts.filter((draft) => draft.email).forEach((draft) => {
              track(draft, 'sendAll', 'Included in Global broadcast');
              recordSend(draft, 'outlook');
            });
            toast.success(`Broadcast opened for ${recipients.length} manager(s)`);
          }}
        />
      ) : (
        <PerManagerDrafts
          process={process}
          drafts={visibleDrafts}
          theme={theme}
          setTheme={(nextTheme) => {
            setTheme(nextTheme);
            setTemplate((current) => ({ ...current, ...defaultTemplateForTheme(nextTheme) }));
          }}
          deadline={deadline}
          setDeadline={setDeadline}
          template={template}
          setTemplate={setTemplate}
          onlyUnreviewed={onlyUnreviewed}
          setOnlyUnreviewed={setOnlyUnreviewed}
          search={managerSearch}
          setSearch={setManagerSearch}
          setSelected={setSelected}
          active={active}
          sendAll={sendAll}
          validRecipientCount={validRecipientCount}
          openOutlook={openOutlook}
          downloadDraft={downloadDraft}
          openTeams={openTeams}
          onCopyDraft={copyDraft}
          onSaveNamed={(name) => {
            saveTemplate(process.id, name, theme, template);
            toast.success(`Saved "${name}"`);
          }}
        />
      )}
      {process.serverBacked && process.displayCode ? (
        <SendLogPanel processCode={process.displayCode} />
      ) : null}
    </div>
  );
}
