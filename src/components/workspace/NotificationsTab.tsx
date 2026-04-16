import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { buildGeneralNotification, buildNotificationDrafts, downloadEml, notificationPlainText, openMailDraft, openTeamsMessage } from '../../lib/notificationBuilder';
import type { AuditProcess, AuditResult, NotificationDraft } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { EmptyState } from '../shared/EmptyState';

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
  const drafts = useMemo(() => buildNotificationDrafts(result?.issues ?? [], theme, deadline, template), [result, theme, deadline, template]);
  const active = drafts[selected] ?? drafts[0];

  function track(draft: NotificationDraft, channel: 'outlook' | 'eml' | 'teams' | 'sendAll', note: string) {
    recordTrackingEvent(process.id, draft.pmName, draft.email, draft.issueCount, channel, note);
  }

  function openOutlook(draft: NotificationDraft) {
    openMailDraft([draft.email], draft.subject, notificationPlainText(draft));
    track(draft, 'outlook', 'Opened Outlook mail draft');
  }

  function downloadDraft(draft: NotificationDraft) {
    downloadEml(draft);
    track(draft, 'eml', 'Downloaded .eml draft');
    toast.success('Draft downloaded and tracking updated');
  }

  function openTeams(draft: NotificationDraft) {
    openTeamsMessage(draft.email, notificationPlainText(draft));
    track(draft, 'teams', 'Opened Teams escalation');
  }

  function sendAll() {
    if (!drafts.length) return;
    const general = buildGeneralNotification(drafts);
    openMailDraft(general.recipients, general.subject, general.body);
    drafts.forEach((draft) => track(draft, 'sendAll', 'Included in Send All general Outlook draft'));
    toast.success(`General draft opened for ${general.recipients.length} manager(s)`);
  }

  if (!result) return <EmptyState title="No notification drafts yet">Run an audit first to group flagged projects by project manager.</EmptyState>;

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Notification Drafts ({drafts.length} managers)</h2>
          <button onClick={sendAll} disabled={!drafts.length} className="rounded-lg bg-[#b00020] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#8f001a] disabled:opacity-40">Send All</button>
        </div>
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
              {key}
              <input value={template[key as keyof typeof template]} onChange={(event) => setTemplate((state) => ({ ...state, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" />
            </label>
          ))}
        </details>
        <div className="space-y-2">
          {drafts.map((draft, index) => {
            const tracking = process.notificationTracking[`${process.id}:${draft.email}`];
            return (
              <button key={draft.email} onClick={() => setSelected(index)} className={`w-full rounded-lg border p-3 text-left text-sm ${active?.email === draft.email ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="font-medium">{draft.pmName}</div>
                <div className="text-xs text-gray-500">{draft.email}</div>
                <div className="mt-1 text-xs text-gray-500">{draft.issueCount} flagged projects · {tracking?.stage ?? draft.stage}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span onClick={(event) => { event.stopPropagation(); navigator.clipboard.writeText(notificationPlainText(draft)); toast.success('Draft copied'); }} className="rounded border border-gray-300 px-2 py-1 text-xs">Copy</span>
                  <span onClick={(event) => { event.stopPropagation(); openOutlook(draft); }} className="rounded border border-gray-300 px-2 py-1 text-xs">Open Outlook</span>
                  <span onClick={(event) => { event.stopPropagation(); downloadDraft(draft); }} className="rounded border border-gray-300 px-2 py-1 text-xs">Download .eml</span>
                  <span onClick={(event) => { event.stopPropagation(); openTeams(draft); }} className="rounded border border-gray-300 px-2 py-1 text-xs">Teams</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="font-semibold">Preview</h2>
        {active ? <div className="prose prose-sm mt-4 max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: active.htmlBody }} /> : <p className="mt-4 text-sm text-gray-500">No flagged managers in this audit.</p>}
      </section>
    </div>
  );
}
