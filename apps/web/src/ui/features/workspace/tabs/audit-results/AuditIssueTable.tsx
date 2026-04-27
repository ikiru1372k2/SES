/**
 * AuditIssueTable — the main issue table with expandable detail rows,
 * inline comments, corrections, and acknowledgment controls.
 */
import { Fragment, FormEvent, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { AiBadge } from '../../../../../components/ai-pilot/AiBadge';
import { auditIssueKey } from '../../../../../lib/auditEngine';
import { severityTone } from '../../../../../lib/severity';
import { selectIssueComments, selectIssueCorrection } from '../../../../../store/selectors';
import { useAppStore } from '../../../../../store/useAppStore';
import { Badge } from '../../../../../components/shared/Badge';
import { Button } from '../../../../../components/shared/Button';
import type {
  AcknowledgmentStatus,
  AuditIssue,
  AuditProcess,
  IssueComment,
  IssueCorrection,
} from '../../../../../lib/types';
import type { SortKey } from './AuditFilterBar';

export interface AuditIssueTableProps {
  filtered: AuditIssue[];
  process: AuditProcess;
  isMasterData: boolean;
  issueHeaders: Array<{ key: SortKey; label: string }>;
  /** Deep-link highlight support */
  highlightedRowId: string | null;
  flashRowId: string | null;
  attachHighlightRef: (node: HTMLTableRowElement | null) => void;
  expanded: string;
  onExpandToggle: (id: string) => void;
  onSortChange: (key: SortKey) => void;
  canEdit: boolean;
  editTooltip: string | undefined;
}

export function AuditIssueTable({
  filtered,
  process,
  isMasterData,
  issueHeaders,
  highlightedRowId,
  flashRowId,
  attachHighlightRef,
  expanded,
  onExpandToggle,
  onSortChange,
  canEdit,
  editTooltip,
}: AuditIssueTableProps) {
  const addIssueComment = useAppStore((state) => state.addIssueComment);
  const deleteIssueComment = useAppStore((state) => state.deleteIssueComment);
  const saveIssueCorrection = useAppStore((state) => state.saveIssueCorrection);
  const clearIssueCorrection = useAppStore((state) => state.clearIssueCorrection);
  const setIssueAcknowledgment = useAppStore((state) => state.setIssueAcknowledgment);

  return (
    <div className="overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-700">
          <tr>
            {issueHeaders.map(({ key, label }) => (
              <th
                key={key}
                scope="col"
                onClick={() => onSortChange(key)}
                className="cursor-pointer whitespace-nowrap p-3 font-semibold"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((issue) => (
            <Fragment key={issue.id}>
              <tr
                ref={highlightedRowId === issue.id ? attachHighlightRef : null}
                onClick={() => onExpandToggle(issue.id)}
                className={`group cursor-pointer border-t border-gray-100 align-top even:bg-gray-50/60 hover:bg-gray-100 dark:border-gray-700 dark:even:bg-gray-900/40 dark:hover:bg-gray-700 ${
                  flashRowId === issue.id
                    ? 'bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-500 ring-inset'
                    : ''
                }`}
              >
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      size={15}
                      className={`transition ${expanded === issue.id ? 'rotate-90' : ''}`}
                    />
                    <Badge tone={severityTone[issue.severity]}>{issue.severity}</Badge>
                  </div>
                </td>
                <td className="p-3">{issue.projectNo}</td>
                <td className="p-3">{issue.projectName}</td>
                <td className="p-3">{issue.projectManager}</td>
                <td className="p-3 text-xs text-gray-600 dark:text-gray-300">
                  {issue.email?.trim() ? issue.email : '—'}
                </td>
                <td className="p-3">{issue.sheetName}</td>
                <td className="p-3">{issue.projectState}</td>
                {!isMasterData ? <td className="p-3">{issue.effort}</td> : null}
                <td className="max-w-lg p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge
                      tone={
                        issue.category === 'Needs Review'
                          ? 'amber'
                          : issue.category === 'Data Quality'
                            ? 'blue'
                            : 'gray'
                      }
                    >
                      {issue.ruleName ?? issue.auditStatus}
                    </Badge>
                    {issue.ruleCode?.startsWith('ai_') ? (
                      <AiBadge tooltip="Authored via AI Pilot" />
                    ) : null}
                    {issue.category === 'Needs Review' ? (
                      <Badge tone="amber">Needs review</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 text-gray-700 dark:text-gray-200">
                    {issue.reason ?? issue.notes}
                  </div>
                  <div className="mt-1 hidden text-xs text-gray-400 group-hover:block">
                    Click for details, notes, and corrections
                  </div>
                </td>
              </tr>

              {expanded === issue.id ? (
                <tr className="border-t border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                  <td colSpan={isMasterData ? 8 : 9} className="p-4">
                    <div className="grid gap-3 text-sm md:grid-cols-4">
                      <Detail label="Why flagged?" value={issue.reason ?? issue.notes} />
                      <Detail label="Category" value={issue.category ?? 'Audit rule'} />
                      <Detail label="Threshold" value={issue.thresholdLabel ?? '-'} />
                      <Detail
                        label="Recommended action"
                        value={issue.recommendedAction ?? 'Review this project with the owner.'}
                      />
                    </div>

                    <IssueComments
                      comments={selectIssueComments(process, issue)}
                      onAdd={(body) => addIssueComment(process.id, auditIssueKey(issue), body)}
                      onDelete={(commentId) =>
                        deleteIssueComment(process.id, auditIssueKey(issue), commentId)
                      }
                      canEdit={canEdit}
                      readOnlyReason={editTooltip}
                    />

                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold text-gray-500">
                        Auditor decision
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(
                          ['needs_review', 'acknowledged', 'corrected'] as AcknowledgmentStatus[]
                        ).map((statusOption) => {
                          const current =
                            process.acknowledgments?.[auditIssueKey(issue)]?.status ??
                            'needs_review';
                          const label =
                            statusOption === 'needs_review'
                              ? 'Needs review'
                              : statusOption === 'acknowledged'
                                ? 'Acknowledged'
                                : 'Corrected';
                          const active = current === statusOption;
                          return (
                            <button
                              key={statusOption}
                              type="button"
                              disabled={!canEdit}
                              title={editTooltip}
                              onClick={(e) => {
                                e.stopPropagation();
                                setIssueAcknowledgment(
                                  process.id,
                                  auditIssueKey(issue),
                                  statusOption,
                                );
                              }}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                                active
                                  ? 'border-brand bg-brand-subtle text-brand'
                                  : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <IssueCorrectionEditor
                      issue={issue}
                      correction={selectIssueCorrection(process, issue)}
                      onSave={(correction) =>
                        saveIssueCorrection(process.id, auditIssueKey(issue), correction)
                      }
                      onClear={() => clearIssueCorrection(process.id, auditIssueKey(issue))}
                      canEdit={canEdit}
                      readOnlyReason={editTooltip}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!filtered.length ? (
        <div className="p-5 text-sm text-gray-500">No issues match your filters.</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function IssueComments({
  comments,
  onAdd,
  onDelete,
  canEdit = true,
  readOnlyReason,
}: {
  comments: IssueComment[];
  onAdd: (body: string) => void;
  onDelete: (commentId: string) => void;
  canEdit?: boolean;
  readOnlyReason?: string | undefined;
}) {
  const [body, setBody] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    onAdd(body);
    setBody('');
  }

  return (
    <section className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">Audit trail</h4>
        <span className="text-xs text-gray-500">
          {comments.length} comment{comments.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {comments.map((comment) => (
          <div
            key={comment.id}
            className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-500">
                  {comment.author} - {new Date(comment.createdAt).toLocaleString()}
                </div>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{comment.body}</p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(comment.id)}
                disabled={!canEdit}
                title={canEdit ? undefined : readOnlyReason}
                className="text-xs text-gray-400 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:text-gray-300"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {!comments.length ? (
          <div className="text-sm text-gray-500">
            No notes yet. Capture PM feedback, approval context, or follow-up details here.
          </div>
        ) : null}
      </div>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={canEdit ? 'Add audit note...' : 'Read-only — comments disabled'}
          disabled={!canEdit}
          title={canEdit ? undefined : readOnlyReason}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
        />
        <Button type="submit" size="sm" disabled={!canEdit || !body.trim()} title={canEdit ? undefined : readOnlyReason}>
          Add note
        </Button>
      </form>
    </section>
  );
}

function IssueCorrectionEditor({
  issue,
  correction,
  onSave,
  onClear,
  canEdit = true,
  readOnlyReason,
}: {
  issue: AuditIssue;
  correction?: IssueCorrection | undefined;
  onSave: (correction: Omit<IssueCorrection, 'issueKey' | 'processId' | 'updatedAt'>) => void;
  onClear: () => void;
  canEdit?: boolean;
  readOnlyReason?: string | undefined;
}) {
  const [effort, setEffort] = useState(String(correction?.effort ?? issue.effort));
  const [projectState, setProjectState] = useState(
    correction?.projectState ?? issue.projectState,
  );
  const [projectManager, setProjectManager] = useState(
    correction?.projectManager ?? issue.projectManager,
  );
  const [note, setNote] = useState(correction?.note ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    onSave({
      effort: Number(effort) || 0,
      projectState: projectState.trim(),
      projectManager: projectManager.trim(),
      note,
    });
  }

  return (
    <section
      className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700"
      title={canEdit ? undefined : readOnlyReason}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">Inline correction</h4>
        {correction ? (
          <span className="text-xs text-gray-500">
            Updated {new Date(correction.updatedAt).toLocaleString()}
          </span>
        ) : null}
      </div>
      <form onSubmit={submit} className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="text-xs text-gray-500">
          Effort
          <input
            value={effort}
            disabled={!canEdit}
            onChange={(e) => setEffort(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          State
          <input
            value={projectState}
            disabled={!canEdit}
            onChange={(e) => setProjectState(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Manager
          <input
            value={projectManager}
            disabled={!canEdit}
            onChange={(e) => setProjectManager(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Note
          <input
            value={note}
            disabled={!canEdit}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <div className="flex gap-2 md:col-span-4">
          <Button type="submit" size="sm" disabled={!canEdit} title={canEdit ? undefined : readOnlyReason}>
            Save correction
          </Button>
          {correction ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onClear}
              disabled={!canEdit}
              title={canEdit ? undefined : readOnlyReason}
            >
              Clear correction
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
