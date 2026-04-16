import { MoreVertical } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import toast from 'react-hot-toast';
import { buildNotificationDrafts, isValidEmail, managerKey } from '../../lib/notificationBuilder';
import { makeDefaultTrackingEntry, PIPELINE_COLUMNS, type PipelineKey, pipelineKey, trackingKey } from '../../lib/tracking';
import type {
  AuditIssue,
  AuditProcess,
  AuditResult,
  ProjectTrackingStage,
  ProjectTrackingStatus,
  TrackingEntry,
} from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { EmptyState } from '../shared/EmptyState';

export function TrackingTab({ process, result }: { process: AuditProcess; result: AuditResult | null }) {
  const recordTrackingEvent = useAppStore((state) => state.recordTrackingEvent);
  const markTrackingResolved = useAppStore((state) => state.markTrackingResolved);
  const reopenTracking = useAppStore((state) => state.reopenTracking);
  const updateProjectStatus = useAppStore((state) => state.updateProjectStatus);
  const [search, setSearch] = useState('');
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<PipelineKey | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const drafts = useMemo(
    () => buildNotificationDrafts({ issues: result?.issues ?? [], theme: 'Company Reminder', deadline: '' }),
    [result],
  );

  const entries = useMemo(() => {
    const managerIssues = new Map<string, { name: string; email: string; count: number }>();
    (result?.issues ?? []).forEach((issue) => {
      const email = isValidEmail(issue.email) ? issue.email : null;
      const key = managerKey(issue.projectManager, email);
      const current = managerIssues.get(key) ?? { name: issue.projectManager, email: key, count: 0 };
      current.count += 1;
      managerIssues.set(key, current);
    });
    return [...managerIssues.values()].map((manager) => {
      const tracking = process.notificationTracking[trackingKey(process.id, manager.email)];
      return tracking ?? makeDefaultTrackingEntry(process.id, manager.name, manager.email, manager.count);
    });
  }, [process.id, process.notificationTracking, result]);

  const searched = entries.filter((entry) => {
    const text = `${entry.managerName} ${entry.managerEmail}`.toLowerCase();
    return !search || text.includes(search.toLowerCase());
  });

  const grouped = PIPELINE_COLUMNS.reduce<Record<PipelineKey, TrackingEntry[]>>(
    (acc, column) => ({ ...acc, [column.key]: [] }),
    { notContacted: [], notified: [], escalated: [], resolved: [] },
  );
  for (const entry of searched) {
    grouped[pipelineKey(entry)].push(entry);
  }

  function moveTo(entry: TrackingEntry, target: PipelineKey) {
    if (pipelineKey(entry) === target) return;
    if (target === 'resolved') {
      markTrackingResolved(process.id, entry.managerEmail);
      toast.success(`${entry.managerName} marked resolved`);
      return;
    }
    if (entry.resolved) {
      reopenTracking(process.id, entry.managerEmail);
    }
    if (target === 'notified') {
      recordTrackingEvent(process.id, entry.managerName, entry.managerEmail, entry.flaggedProjectCount, 'manual', 'Moved to Notified');
    }
    if (target === 'escalated') {
      recordTrackingEvent(process.id, entry.managerName, entry.managerEmail, entry.flaggedProjectCount, 'teams', 'Moved to Escalated');
    }
    if (target === 'notContacted') {
      reopenTracking(process.id, entry.managerEmail);
    }
    toast.success(`${entry.managerName} moved to ${target === 'notContacted' ? 'Not contacted' : target[0]!.toUpperCase() + target.slice(1)}`);
  }

  function onDragStart(event: DragEvent<HTMLDivElement>, key: string) {
    setDraggingKey(key);
    event.dataTransfer.setData('text/plain', key);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd() {
    setDraggingKey(null);
    setHoverColumn(null);
  }

  function onDragOverColumn(event: DragEvent<HTMLDivElement>, column: PipelineKey) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setHoverColumn(column);
  }

  function onDropColumn(event: DragEvent<HTMLDivElement>, column: PipelineKey) {
    event.preventDefault();
    const key = event.dataTransfer.getData('text/plain');
    const entry = entries.find((e) => e.key === key);
    if (entry) moveTo(entry, column);
    setDraggingKey(null);
    setHoverColumn(null);
  }

  if (!result) {
    return (
      <div className="p-5">
        <EmptyState title="No tracking data yet">Run an audit to start tracking manager escalation.</EmptyState>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-5">
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search managers..."
          className="min-w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <div className="text-sm text-gray-500">
          {entries.length} manager(s) · drag cards between columns or use the menu
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-4">
        {PIPELINE_COLUMNS.map((column) => (
          <div
            key={column.key}
            onDragOver={(event) => onDragOverColumn(event, column.key)}
            onDragLeave={() => setHoverColumn(null)}
            onDrop={(event) => onDropColumn(event, column.key)}
            className={`flex min-h-0 flex-col rounded-xl border-2 ${column.accent} bg-white dark:bg-gray-800 ${
              hoverColumn === column.key ? 'ring-2 ring-brand' : ''
            }`}
          >
            <div className="shrink-0 border-b border-gray-100 p-3 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{column.title}</h3>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold dark:bg-gray-700">
                  {grouped[column.key].length}
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {grouped[column.key].map((entry) => {
                const draft = drafts.find((d) => d.recipientKey === entry.managerEmail);
                return (
                  <ManagerCard
                    key={entry.key}
                    entry={entry}
                    draft={draft}
                    processId={process.id}
                    dragging={draggingKey === entry.key}
                    expanded={expandedKey === entry.key}
                    onDragStart={(event) => onDragStart(event, entry.key)}
                    onDragEnd={onDragEnd}
                    onExpand={() => setExpandedKey(expandedKey === entry.key ? null : entry.key)}
                    onMove={(target) => moveTo(entry, target)}
                    onUpdateProjectStatus={(projectNo, patch) =>
                      updateProjectStatus(process.id, entry.managerEmail, projectNo, patch)
                    }
                  />
                );
              })}
              {!grouped[column.key].length ? (
                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400 dark:border-gray-700">
                  Drop a manager here
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManagerCard({
  entry,
  draft,
  processId,
  dragging,
  expanded,
  onDragStart,
  onDragEnd,
  onExpand,
  onMove,
  onUpdateProjectStatus,
}: {
  entry: TrackingEntry;
  draft: ReturnType<typeof buildNotificationDrafts>[number] | undefined;
  processId: string;
  dragging: boolean;
  expanded: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onExpand: () => void;
  onMove: (target: PipelineKey) => void;
  onUpdateProjectStatus: (
    projectNo: string,
    patch: Partial<Pick<ProjectTrackingStatus, 'stage' | 'feedback'>>,
  ) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`relative rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-900 ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{entry.managerName}</div>
          <div className="truncate text-xs text-gray-500">{draft?.email ?? 'No email'}</div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Move menu"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen ? (
          <div className="absolute right-2 top-8 z-10 w-40 rounded-lg border border-gray-200 bg-white p-1 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <button type="button" onClick={() => { onMove('notContacted'); setMenuOpen(false); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700">
              Move to Not contacted
            </button>
            <button type="button" onClick={() => { onMove('notified'); setMenuOpen(false); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700">
              Move to Notified
            </button>
            <button type="button" onClick={() => { onMove('escalated'); setMenuOpen(false); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700">
              Move to Escalated
            </button>
            <button type="button" onClick={() => { onMove('resolved'); setMenuOpen(false); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700">
              Move to Resolved
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 text-xs text-gray-500">
        {entry.flaggedProjectCount} flagged · Outlook: {entry.outlookCount} · Teams: {entry.teamsCount}
      </div>
      {entry.lastContactAt ? (
        <div className="mt-1 text-xs text-gray-400">Last: {new Date(entry.lastContactAt).toLocaleDateString()}</div>
      ) : null}
      <button
        type="button"
        onClick={onExpand}
        className="mt-2 w-full rounded border border-gray-200 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {expanded ? 'Hide projects' : `Show ${draft?.projects.length ?? 0} project${draft?.projects.length === 1 ? '' : 's'}`}
      </button>
      {expanded && draft ? (
        <div className="mt-2 space-y-2">
          {draft.projects.map((issue) => {
            const status = entry.projectStatuses?.[issue.projectNo];
            const currentStage = status?.stage ?? 'open';
            return (
              <ProjectRow
                key={`${processId}:${entry.managerEmail}:${issue.id}`}
                issue={issue}
                status={status}
                currentStage={currentStage}
                onStageChange={(stage) => onUpdateProjectStatus(issue.projectNo, { stage })}
                onFeedbackChange={(feedback) => onUpdateProjectStatus(issue.projectNo, { feedback })}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ProjectRow({
  issue,
  status,
  currentStage,
  onStageChange,
  onFeedbackChange,
}: {
  issue: AuditIssue;
  status: ProjectTrackingStatus | undefined;
  currentStage: ProjectTrackingStage;
  onStageChange: (stage: ProjectTrackingStage) => void;
  onFeedbackChange: (feedback: string) => void;
}) {
  const [draft, setDraft] = useState(status?.feedback ?? '');
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="rounded bg-gray-50 p-2 text-xs dark:bg-gray-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{issue.projectNo} – {issue.projectName}</div>
          <div className="text-gray-500">{issue.severity} · {issue.effort}h</div>
        </div>
        <select
          value={currentStage}
          onChange={(event) => onStageChange(event.target.value as ProjectTrackingStage)}
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-900"
        >
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="corrected">Corrected</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== (status?.feedback ?? '')) onFeedbackChange(draft);
        }}
        placeholder="Manager feedback..."
        className="mt-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
        rows={2}
      />
      {status && status.history.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowHistory((value) => !value)}
          className="mt-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
        >
          {showHistory ? 'Hide' : 'Show'} history ({status.history.length})
        </button>
      ) : null}
      {showHistory && status ? (
        <div className="mt-1 space-y-0.5">
          {status.history.map((event, index) => (
            <div key={index} className="text-[11px] text-gray-500">
              {new Date(event.at).toLocaleString()}: {event.note}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
