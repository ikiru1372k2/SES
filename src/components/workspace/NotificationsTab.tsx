import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { auditIssueKey } from '../../lib/auditEngine';
import { buildGeneralNotification, buildNotificationDrafts, downloadEml, notificationPlainText, openMailDraft, openTeamsMessage } from '../../lib/notificationBuilder';
import type { AuditProcess, AuditResult, NotificationDraft } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { EmptyState } from '../shared/EmptyState';

const templateLabels = {
  greeting: 'Greeting',
  intro: 'Introduction',
  actionLine: 'Action request',
  deadlineLine: 'Deadline phrase',
  closing: 'Closing',
  signature1: 'Signature line 1',
  signature2: 'Signature line 2',
};

export function NotificationsTab({ process, result }: { process: AuditProcess; result: AuditResult | null }) {
  const recordTrackingEvent = useAppStore((state) => state.recordTrackingEvent);
  const [theme, setTheme] = useState<NotificationDraft['theme']>('Company Reminder');
  const [deadline, setDeadline] = useState('');
  const [selected, setSelected] = useState(0);
  const [template, setTemplate] = useState({
    greeting: 'Dear',
    intro: 'Your effort workbook has flagged the projects below.',
    actionLine: 'Please review and update the workbook',
    deadlineLine: 'by',
    closing: 'Thank you for closing these audit items.',
    signature1: 'Effort Audit Team',
    signature2: 'Workbook Auditor',
  });
  const drafts = useMemo(() => buildNotificationDrafts(result?.issues ?? [], theme, deadline, template, process.corrections), [process.corrections, result, theme, deadline, template]);
  const active = drafts[selected] ?? drafts[0];

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
    if (!drafts.length) return;
    const general = buildGeneralNotification(drafts);
    if (!general.recipients.length) {
      toast.error('No valid manager emails found in the workbook');
      return;
    }
    openMailDraft(general.recipients, general.subject, general.body);
    drafts.filter((draft) => draft.email).forEach((draft) => track(draft, 'sendAll', 'Included in Send All general Outlook draft'));
    toast.success(`General draft opened for ${general.recipients.length} manager(s)`);
  }

  if (!result) return <EmptyState title="No notification drafts yet">Run an audit first to group flagged projects by project manager.</EmptyState>;

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Notification Drafts ({drafts.length} managers)</h2>
        <button onClick={sendAll} disabled={!drafts.length} className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40">Send All ({drafts.filter((draft) => draft.email).length} managers)</button>
        <label className="block text-xs font-medium text-gray-500">Theme</label>
        <select value={theme} onChange={(event) => setTheme(event.target.value as NotificationDraft['theme'])} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
          <option>Company Reminder</option><option>Executive Summary</option><option>Compact Update</option>
        </select>
        <label className="block text-xs font-medium text-gray-500">Deadline</label>
        <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" />
        <details className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <summary className="cursor-pointer text-sm font-medium">Edit Template</summary>
          {Object.keys(template).map((key) => (
            <label key={key} className="mt-3 block text-xs text-gray-500">
              {templateLabels[key as keyof typeof template]}
              <input value={template[key as keyof typeof template]} onChange={(event) => setTemplate((state) => ({ ...state, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" />
            </label>
          ))}
        </details>
        <div className="space-y-2">
          {drafts.map((draft, index) => {
            const tracking = process.notificationTracking[`${process.id}:${draft.recipientKey}`];
            return (
              <button key={draft.recipientKey} onClick={() => setSelected(index)} className={`w-full rounded-lg border p-3 text-left text-sm ${active?.recipientKey === draft.recipientKey ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="font-medium">{draft.pmName}</div>
                <div className={draft.email ? 'text-xs text-gray-500' : 'text-xs font-medium text-red-600'}>{draft.email ?? 'Missing manager email'}</div>
                <div className="mt-1 text-xs text-gray-500">{draft.issueCount} flagged projects · {draft.pendingCorrectionCount} correction(s) · {tracking?.stage ?? draft.stage}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(notificationPlainText(draft)); toast.success('Draft copied'); }} className="rounded border border-gray-300 px-2 py-1 text-xs">Copy</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); openOutlook(draft); }} className={`rounded border border-gray-300 px-2 py-1 text-xs ${draft.email ? '' : 'opacity-40'}`}>Open Outlook</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); downloadDraft(draft); }} className={`rounded border border-gray-300 px-2 py-1 text-xs ${draft.email ? '' : 'opacity-40'}`}>Download .eml</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); openTeams(draft); }} className={`rounded border border-gray-300 px-2 py-1 text-xs ${draft.email ? '' : 'opacity-40'}`}>Teams</button>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Preview</h2>
        {active ? <NotificationPreview draft={active} deadline={deadline} template={template} /> : <p className="mt-4 text-sm text-gray-500">No flagged managers in this audit.</p>}
      </section>
    </div>
  );
}

function NotificationPreview({ draft, deadline, template }: { draft: NotificationDraft; deadline: string; template: { intro: string; actionLine: string; closing: string; signature1: string; signature2: string } }) {
  return (
    <div className="prose prose-sm mt-4 max-w-none dark:prose-invert">
      <p>Dear {draft.pmName},</p>
      <p>{template.intro}</p>
      <p>The following {draft.issueCount} project(s) require your attention:</p>
      <table>
        <thead>
          <tr><th>Project No</th><th>Project</th><th>Severity</th><th>Notes</th>{draft.pendingCorrectionCount ? <><th>Proposed Effort</th><th>Correction Note</th></> : null}</tr>
        </thead>
        <tbody>
          {draft.projects.map((issue) => {
            const correction = draft.corrections[auditIssueKey(issue)];
            return (
              <tr key={issue.id}>
                <td>{issue.projectNo}</td>
                <td>{issue.projectName}</td>
                <td>{issue.severity}</td>
                <td>{issue.notes}</td>
                {draft.pendingCorrectionCount ? <><td>{correction ? `${issue.effort} -> ${correction.effort ?? issue.effort}` : ''}</td><td>{correction?.note ?? ''}</td></> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>{template.actionLine} by {deadline || 'the agreed deadline'}.</p>
      <p>{template.closing}</p>
      <p>{template.signature1}<br />{template.signature2}</p>
    </div>
  );
}
