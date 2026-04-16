import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import { auditIssueKey } from '../../lib/auditEngine';
import {
  buildGeneralNotification,
  buildNotificationDrafts,
  defaultTemplateForTheme,
  downloadEml,
  notificationPlainText,
  openMailDraft,
  openTeamsMessage,
} from '../../lib/notificationBuilder';
import type { AuditProcess, AuditResult, NotificationDraft, NotificationTemplate, NotificationTheme } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { EmptyState } from '../shared/EmptyState';
import { TemplateEditor } from './TemplateEditor';

const THEMES: NotificationTheme[] = [
  'Company Reminder',
  'Executive Summary',
  'Compact Update',
  'Formal',
  'Urgent',
  'Friendly Follow-up',
  'Escalation',
];

type TemplateState = NotificationTemplate;

export function NotificationsTab({ process, result }: { process: AuditProcess; result: AuditResult | null }) {
  const recordTrackingEvent = useAppStore((state) => state.recordTrackingEvent);
  const saveTemplate = useAppStore((state) => state.saveTemplate);
  const [mode, setMode] = useState<'broadcast' | 'perManager'>('broadcast');
  const [theme, setTheme] = useState<NotificationTheme>('Company Reminder');
  const [deadline, setDeadline] = useState('');
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [broadcastSubject, setBroadcastSubject] = useState('QGC audit cycle summary');
  const [broadcastBody, setBroadcastBody] = useState(
    'Dear Project Managers,\n\nThe latest QGC workbook audit has identified items that require your attention. Please review your flagged projects in the attached workbook and update effort planning before the next escalation review.\n\nThank you,\nEffort Audit Team',
  );
  const [template, setTemplate] = useState<TemplateState>({
    greeting: 'Dear',
    deadlineLine: 'by',
    ...defaultTemplateForTheme('Company Reminder'),
  });

  const drafts = useMemo(
    () =>
      buildNotificationDrafts(
        result?.issues ?? [],
        theme,
        deadline,
        template,
        process.corrections,
        process.comments,
        process.acknowledgments ?? {},
      ),
    [process.corrections, process.comments, process.acknowledgments, result, theme, deadline, template],
  );
  const visibleDrafts = useMemo(
    () => (onlyUnreviewed ? drafts.filter((draft) => draft.unreviewedCount > 0) : drafts),
    [drafts, onlyUnreviewed],
  );
  const active = visibleDrafts[selected] ?? visibleDrafts[0];
  const validRecipientCount = visibleDrafts.filter((draft) => draft.email).length;

  function track(draft: NotificationDraft, channel: 'outlook' | 'eml' | 'teams' | 'sendAll', note: string) {
    recordTrackingEvent(process.id, draft.pmName, draft.recipientKey, draft.issueCount, channel, note);
  }

  function openOutlook(draft: NotificationDraft) {
    if (!draft.email) {
      toast.error('Add a project manager email in the workbook before opening Outlook');
      return;
    }
    openMailDraft([draft.email], draft.subject, notificationPlainText(draft));
    track(draft, 'outlook', 'Opened Outlook mail draft');
  }

  function downloadDraft(draft: NotificationDraft) {
    if (!draft.email) {
      toast.error('Add a project manager email in the workbook before downloading .eml');
      return;
    }
    downloadEml(draft);
    track(draft, 'eml', 'Downloaded .eml draft');
    toast.success('Draft downloaded and tracking updated');
  }

  function openTeams(draft: NotificationDraft) {
    if (!draft.email) {
      toast.error('Add a project manager email in the workbook before opening Teams');
      return;
    }
    openTeamsMessage(draft.email, notificationPlainText(draft));
    track(draft, 'teams', 'Opened Teams escalation');
  }

  function sendAll() {
    if (!visibleDrafts.length) return;
    const general = buildGeneralNotification(visibleDrafts);
    if (!general.recipients.length) {
      toast.error('No valid manager emails found in the workbook');
      return;
    }
    openMailDraft(general.recipients, general.subject, general.body);
    visibleDrafts
      .filter((draft) => draft.email)
      .forEach((draft) => track(draft, 'sendAll', 'Included in Send All general Outlook draft'));
    toast.success(`General draft opened for ${general.recipients.length} manager(s)`);
  }

  if (!result) {
    return (
      <div className="p-5">
        <EmptyState title="No notification drafts yet">Run an audit first to group flagged projects by project manager.</EmptyState>
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
      {mode === 'broadcast' ? (
        <BroadcastComposer
          drafts={drafts}
          subject={broadcastSubject}
          body={broadcastBody}
          onSubjectChange={setBroadcastSubject}
          onBodyChange={setBroadcastBody}
          onSend={(recipients, subject, body) => {
            openMailDraft(recipients, subject, body);
            drafts.filter((draft) => draft.email).forEach((draft) => track(draft, 'sendAll', 'Included in Global broadcast'));
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
          setSelected={setSelected}
          active={active}
          sendAll={sendAll}
          validRecipientCount={validRecipientCount}
          openOutlook={openOutlook}
          downloadDraft={downloadDraft}
          openTeams={openTeams}
          onSaveNamed={(name) => {
            saveTemplate(process.id, name, theme, template);
            toast.success(`Saved "${name}"`);
          }}
        />
      )}
    </div>
  );
}

function PerManagerDrafts({
  process,
  drafts,
  theme,
  setTheme,
  deadline,
  setDeadline,
  template,
  setTemplate,
  onlyUnreviewed,
  setOnlyUnreviewed,
  setSelected,
  active,
  sendAll,
  validRecipientCount,
  openOutlook,
  downloadDraft,
  openTeams,
  onSaveNamed,
}: {
  process: AuditProcess;
  drafts: NotificationDraft[];
  theme: NotificationTheme;
  setTheme: (t: NotificationTheme) => void;
  deadline: string;
  setDeadline: (d: string) => void;
  template: TemplateState;
  setTemplate: (t: TemplateState | ((prev: TemplateState) => TemplateState)) => void;
  onlyUnreviewed: boolean;
  setOnlyUnreviewed: (v: boolean) => void;
  setSelected: (i: number) => void;
  active: NotificationDraft | undefined;
  sendAll: () => void;
  validRecipientCount: number;
  openOutlook: (d: NotificationDraft) => void;
  downloadDraft: (d: NotificationDraft) => void;
  openTeams: (d: NotificationDraft) => void;
  onSaveNamed: (name: string) => void;
}) {
  return (
    <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[340px_1fr]">
      <section className="flex min-h-0 flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 space-y-4">
          <h2 className="font-semibold">Notification Drafts ({drafts.length} managers)</h2>
          <button
            type="button"
            onClick={sendAll}
            disabled={!drafts.length}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            Send All ({validRecipientCount} managers)
          </button>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-500">Theme</label>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((itemTheme) => (
                <button
                  key={itemTheme}
                  type="button"
                  onClick={() => setTheme(itemTheme)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    theme === itemTheme
                      ? 'bg-brand text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'
                  }`}
                >
                  {itemTheme}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-500">Deadline</label>
            <input
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={(event) => setOnlyUnreviewed(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Only managers with un-reviewed projects
          </label>
          <details className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <summary className="cursor-pointer text-sm font-medium">Edit Template</summary>
            <div className="mt-3">
              <TemplateEditor template={template} theme={theme} onChange={setTemplate} onSaveNamed={onSaveNamed} />
            </div>
          </details>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {drafts.map((draft, index) => (
            <DraftCard
              key={draft.recipientKey}
              draft={draft}
              stage={process.notificationTracking[`${process.id}:${draft.recipientKey}`]?.stage}
              isActive={active?.recipientKey === draft.recipientKey}
              onSelect={() => setSelected(index)}
              onCopy={() => {
                void navigator.clipboard.writeText(notificationPlainText(draft));
                toast.success('Draft copied');
              }}
              onOutlook={() => openOutlook(draft)}
              onEml={() => downloadDraft(draft)}
              onTeams={() => openTeams(draft)}
            />
          ))}
        </div>
      </section>
      <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <h2 className="font-semibold">Preview</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {active ? (
            <NotificationPreview draft={active} deadline={deadline} template={template} />
          ) : (
            <p className="mt-4 text-sm text-gray-500">No flagged managers in this audit.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function BroadcastComposer({
  drafts,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  onSend,
}: {
  drafts: NotificationDraft[];
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onSend: (recipients: string[], subject: string, body: string) => void;
}) {
  const recipients = useMemo(
    () => [...new Set(drafts.map((d) => d.email).filter((email): email is string => Boolean(email)))],
    [drafts],
  );

  function handleSend() {
    if (!recipients.length) {
      toast.error('No valid manager emails in the audit');
      return;
    }
    onSend(recipients, subject, body);
  }

  return (
    <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[360px_1fr]">
      <section className="flex min-h-0 flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h2 className="font-semibold">Global broadcast</h2>
          <p className="mt-1 text-xs text-gray-500">One generic message to every manager with a valid email.</p>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500">Recipients</div>
          <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-600">
            {recipients.length ? (
              recipients.map((recipient) => (
                <div key={recipient} className="truncate text-gray-700 dark:text-gray-300">
                  {recipient}
                </div>
              ))
            ) : (
              <div className="text-gray-400">No valid emails in this audit.</div>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">{recipients.length} recipient(s)</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">Subject</label>
          <input
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <label className="block text-xs font-medium text-gray-500">Body</label>
          <textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            className="mt-1 min-h-0 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!recipients.length}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
        >
          Send broadcast ({recipients.length})
        </button>
      </section>
      <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <h2 className="font-semibold">Preview</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="mt-4 max-w-2xl whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="text-xs text-gray-500">Subject</div>
            <div className="mt-1 font-semibold">{subject}</div>
            <hr className="my-3 border-gray-200 dark:border-gray-700" />
            <div className="font-sans">{body}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function DraftCard({
  draft,
  stage,
  isActive,
  onSelect,
  onCopy,
  onOutlook,
  onEml,
  onTeams,
}: {
  draft: NotificationDraft;
  stage: string | undefined;
  isActive: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onOutlook: () => void;
  onEml: () => void;
  onTeams: () => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`w-full cursor-pointer rounded-lg border p-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        isActive
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
          : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
      }`}
    >
      <div className="font-medium">{draft.pmName}</div>
      <div className={draft.email ? 'text-xs text-gray-500' : 'text-xs font-medium text-red-600'}>
        {draft.email ?? 'Missing manager email'}
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {draft.issueCount} flagged · {draft.unreviewedCount} un-reviewed · {draft.pendingCorrectionCount} correction(s) · {stage ?? draft.stage}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOutlook();
          }}
          disabled={!draft.email}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          Open Outlook
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEml();
          }}
          disabled={!draft.email}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          Download .eml
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTeams();
          }}
          disabled={!draft.email}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          Teams
        </button>
      </div>
    </div>
  );
}

function NotificationPreview({ draft, deadline, template }: { draft: NotificationDraft; deadline: string; template: TemplateState }) {
  function severityBg(severity: string): string {
    if (severity === 'High') return 'bg-red-600';
    if (severity === 'Medium') return 'bg-amber-600';
    return 'bg-blue-600';
  }

  return (
    <div className="mt-4 max-w-3xl font-sans text-sm text-gray-900 dark:text-gray-100">
      <p>Dear {draft.pmName},</p>
      <p className="mt-3">{template.intro}</p>
      <p className="mt-3">
        The following <strong>{draft.issueCount}</strong> project(s) require your attention:
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse border border-gray-300 text-xs dark:border-gray-600">
          <thead>
            <tr>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Project No</th>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Project</th>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Severity</th>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Notes</th>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Proposed Effort</th>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Correction Note</th>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Auditor Comments</th>
              <th className="border border-gray-300 bg-gray-100 p-2 text-left font-semibold dark:border-gray-600 dark:bg-gray-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {draft.projects.map((issue, index) => {
              const key = auditIssueKey(issue);
              const correction = draft.corrections[key];
              const comments = draft.comments[key] ?? [];
              const ack = draft.acknowledgments[key];
              const statusLabel = ack
                ? ack.status === 'corrected'
                  ? 'Corrected'
                  : ack.status === 'acknowledged'
                    ? 'Acknowledged'
                    : 'Needs review'
                : 'Needs review';
              const rowBg = index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900';
              return (
                <tr key={issue.id} className={rowBg}>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{issue.projectNo}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{issue.projectName}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">
                    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold text-white ${severityBg(issue.severity)}`}>
                      {issue.severity}
                    </span>
                  </td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{issue.notes}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">
                    {correction ? (
                      <>
                        {issue.effort}h → <strong>{correction.effort ?? issue.effort}h</strong>
                      </>
                    ) : (
                      `${issue.effort}h`
                    )}
                  </td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{correction?.note ?? ''}</td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">
                    {comments.map((c, ci) => (
                      <div key={ci}>{c.body}</div>
                    ))}
                  </td>
                  <td className="border border-gray-200 p-2 align-top dark:border-gray-600">{statusLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4">
        {template.actionLine} by <strong>{deadline || 'the agreed deadline'}</strong>.
      </p>
      <p className="mt-3">{template.closing}</p>
      <p className="mt-6 text-gray-500">
        {template.signature1}
        <br />
        {template.signature2}
      </p>
    </div>
  );
}
