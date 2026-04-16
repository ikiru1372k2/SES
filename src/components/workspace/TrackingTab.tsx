import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { buildNotificationDrafts, notificationPlainText, openMailDraft, openTeamsMessage } from '../../lib/notificationBuilder';
import type { AuditProcess, AuditResult, NotificationDraft, TrackingEntry } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { EmptyState } from '../shared/EmptyState';

type PipelineKey = 'notContacted' | 'outlookSent' | 'teamsSent' | 'resolved';
type FilterKey = 'all' | PipelineKey;

const columns: Array<{ key: PipelineKey; title: string; accent: string }> = [
  { key: 'notContacted', title: 'Not contacted', accent: 'border-gray-400' },
  { key: 'outlookSent', title: 'Outlook sent', accent: 'border-blue-500' },
  { key: 'teamsSent', title: 'Teams sent', accent: 'border-amber-500' },
  { key: 'resolved', title: 'Resolved', accent: 'border-green-600' },
];

function trackingPercent(entry: TrackingEntry): number {
  if (entry.resolved) return 100;
  if (entry.teamsCount > 0) return 80;
  if (entry.outlookCount >= 2) return 60;
  if (entry.outlookCount === 1) return 35;
  return 0;
}

function pipelineKey(entry: TrackingEntry): PipelineKey {
  if (entry.resolved) return 'resolved';
  if (entry.teamsCount > 0) return 'teamsSent';
  if (entry.outlookCount > 0) return 'outlookSent';
  return 'notContacted';
}

function makeFallbackEmail(name: string) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.+|\.+$/g, '') || 'unassigned'}@company.com`;
}

export function TrackingTab({ process, result }: { process: AuditProcess; result: AuditResult | null }) {
  const recordTrackingEvent = useAppStore((state) => state.recordTrackingEvent);
  const markTrackingResolved = useAppStore((state) => state.markTrackingResolved);
  const reopenTracking = useAppStore((state) => state.reopenTracking);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedKey, setSelectedKey] = useState('');

  const drafts = useMemo(() => buildNotificationDrafts(result?.issues ?? [], 'Company Reminder', ''), [result]);
  const draftsByEmail = useMemo(() => new Map(drafts.map((draft) => [draft.email, draft])), [drafts]);

  const entries = useMemo(() => {
    const managerIssues = new Map<string, { name: string; email: string; count: number }>();
    (result?.issues ?? []).forEach((issue) => {
      const email = issue.email || makeFallbackEmail(issue.projectManager);
      const current = managerIssues.get(email) ?? { name: issue.projectManager, email, count: 0 };
      current.count += 1;
      managerIssues.set(email, current);
    });

    return [...managerIssues.values()].map((manager) => {
      const tracking = process.notificationTracking[`${process.id}:${manager.email}`];
      return tracking ?? {
        key: `${process.id}:${manager.email}`,
        processId: process.id,
        managerName: manager.name,
        managerEmail: manager.email,
        flaggedProjectCount: manager.count,
        outlookCount: 0,
        teamsCount: 0,
        lastContactAt: null,
        stage: 'Not contacted' as const,
        resolved: false,
        history: [],
      };
    });
  }, [process.id, process.notificationTracking, result]);

  const searched = entries.filter((entry) => {
    const text = `${entry.managerName} ${entry.managerEmail}`.toLowerCase();
    const matchesSearch = !search || text.includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || pipelineKey(entry) === filter;
    return matchesSearch && matchesFilter;
  });

  const grouped = columns.reduce<Record<PipelineKey, TrackingEntry[]>>((acc, column) => {
    acc[column.key] = searched.filter((entry) => pipelineKey(entry) === column.key);
    return acc;
  }, { notContacted: [], outlookSent: [], teamsSent: [], resolved: [] });

  const selected = entries.find((entry) => entry.key === selectedKey) ?? searched[0] ?? entries[0];
  const selectedDraft = selected ? draftsByEmail.get(selected.managerEmail) : undefined;
  const inProgress = entries.filter((entry) => !entry.resolved && (entry.outlookCount > 0 || entry.teamsCount > 0)).length;

  if (!result) return <EmptyState title="No escalation tracking yet">Run an audit first to create manager tracking from flagged projects.</EmptyState>;

  function track(entry: TrackingEntry, channel: 'outlook' | 'teams' | 'manual', note: string) {
    recordTrackingEvent(process.id, entry.managerName, entry.managerEmail, entry.flaggedProjectCount, channel, note);
  }

  function openOutlook(entry: TrackingEntry, draft?: NotificationDraft) {
    if (draft) openMailDraft([draft.email], draft.subject, notificationPlainText(draft));
    track(entry, 'outlook', 'Opened Outlook mail draft from tracking');
    toast.success('Outlook action recorded');
  }

  function openTeams(entry: TrackingEntry, draft?: NotificationDraft) {
    openTeamsMessage(entry.managerEmail, draft ? notificationPlainText(draft) : `Please review ${entry.flaggedProjectCount} flagged project(s).`);
    track(entry, 'teams', 'Opened Teams escalation from tracking');
    toast.success('Teams action recorded');
  }

  function resolveEntry(entry: TrackingEntry) {
    track(entry, 'manual', 'Prepared manager tracking record before resolution');
    markTrackingResolved(process.id, entry.managerEmail);
    setFilter('all');
    setSelectedKey(`${process.id}:${entry.managerEmail}`);
    toast.success('Manager moved to Resolved');
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">SES - Escalation Tracking</h2>
        <p className="mt-1 text-sm text-gray-500">Compact pipeline view for manager outreach, Teams escalation, and resolution.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Total users" value={entries.length} />
        <SummaryCard label="Not contacted" value={groupCount(entries, 'notContacted')} tone="text-[#b00020]" />
        <SummaryCard label="In progress" value={inProgress} tone="text-amber-700" />
        <SummaryCard label="Resolved" value={groupCount(entries, 'resolved')} tone="text-green-700" />
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or email..."
        className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-900"
      />

      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All'],
          ['notContacted', 'Not contacted'],
          ['outlookSent', 'Outlook sent'],
          ['teamsSent', 'Teams sent'],
          ['resolved', 'Resolved'],
        ] as Array<[FilterKey, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${filter === key ? 'border-[#b00020] bg-red-50 text-[#b00020] dark:bg-red-950/30' : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-4">
        {columns.map((column) => (
          <section key={column.key} className="min-h-72">
            <div className={`mb-3 flex items-center justify-center gap-2 rounded-lg border-t-2 ${column.accent} border-x border-b border-gray-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300`}>
              {column.title}
              <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px]">{grouped[column.key].length}</span>
            </div>
            <div className="space-y-2">
              {grouped[column.key].map((entry) => (
                <TrackingCard key={entry.key} entry={entry} active={selected?.key === entry.key} onClick={() => setSelectedKey(entry.key)} />
              ))}
              {!grouped[column.key].length ? <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400 dark:border-gray-700">-</div> : null}
            </div>
          </section>
        ))}
      </div>

      {selected ? (
        <section className="sticky bottom-0 rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{selected.managerName}</h3>
              <p className="text-sm text-gray-500">{selected.managerEmail}</p>
              <p className="mt-1 text-xs text-gray-500">
                {selected.flaggedProjectCount} flagged project(s) - {selected.stage} - Last contact: {selected.lastContactAt ? new Date(selected.lastContactAt).toLocaleString() : '-'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => openOutlook(selected, selectedDraft)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:border-[#b00020] hover:text-[#b00020] dark:border-gray-700">Open Outlook</button>
              <button onClick={() => openTeams(selected, selectedDraft)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:border-[#b00020] hover:text-[#b00020] dark:border-gray-700">Teams</button>
              {selected.resolved ? (
                <button onClick={() => reopenTracking(process.id, selected.managerEmail)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Reopen</button>
              ) : (
                <button onClick={() => resolveEntry(selected)} className="rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800">Resolve</button>
              )}
              <button onClick={() => setWorkspaceTab('notifications')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Reopen draft</button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function groupCount(entries: TrackingEntry[], key: PipelineKey) {
  return entries.filter((entry) => pipelineKey(entry) === key).length;
}

function SummaryCard({ label, value, tone = 'text-gray-950 dark:text-white' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function TrackingCard({ entry, active, onClick }: { entry: TrackingEntry; active: boolean; onClick: () => void }) {
  const percent = trackingPercent(entry);
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition hover:border-[#b00020]/50 hover:shadow-sm ${active ? 'border-[#b00020] bg-red-50 dark:bg-red-950/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'}`}
    >
      <div className="font-semibold leading-tight">{entry.managerName}</div>
      <div className="truncate text-xs text-gray-500">{entry.managerEmail}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800">{entry.flaggedProjectCount} proj</span>
        {entry.outlookCount ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">OL {entry.outlookCount}</span> : null}
        {entry.teamsCount ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-800">T {entry.teamsCount}</span> : null}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className={entry.resolved ? 'h-full rounded-full bg-green-600' : entry.teamsCount ? 'h-full rounded-full bg-amber-600' : 'h-full rounded-full bg-[#b00020]'} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1 text-right text-xs text-gray-500">{percent}%</div>
    </button>
  );
}
