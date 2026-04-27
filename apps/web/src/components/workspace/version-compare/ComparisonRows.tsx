import { ExternalLink } from 'lucide-react';
import type { AuditIssue, ChangedIssue, DiffableIssueField, IssueFieldDiff } from '@ses/domain';

type BucketKey = 'newIssues' | 'changedIssues' | 'resolvedIssues' | 'unchangedIssues';

const FIELD_LABELS: Record<DiffableIssueField, string> = {
  severity: 'Severity',
  projectManager: 'Manager',
  projectState: 'State',
  effort: 'Effort',
  auditStatus: 'Rule',
  email: 'Email',
  reason: 'Reason',
  recommendedAction: 'Recommended action',
  category: 'Category',
};

export function matchesQuery(issue: AuditIssue, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${issue.projectNo} ${issue.projectName} ${issue.projectManager} ${issue.sheetName} ${issue.reason ?? ''} ${issue.recommendedAction ?? ''}`.toLowerCase();
  return haystack.includes(needle);
}

export function emptyMessageForBucket(bucket: BucketKey): string {
  switch (bucket) {
    case 'newIssues':
      return 'No new findings were introduced between these versions.';
    case 'resolvedIssues':
      return 'No findings were resolved between these versions.';
    case 'changedIssues':
      return 'No shared findings were modified.';
    case 'unchangedIssues':
      return 'No shared findings are still present.';
  }
}

function toneForBucket(bucket: BucketKey): { dot: string } {
  switch (bucket) {
    case 'newIssues':
      return { dot: 'bg-red-500' };
    case 'resolvedIssues':
      return { dot: 'bg-green-500' };
    case 'changedIssues':
      return { dot: 'bg-amber-500' };
    case 'unchangedIssues':
      return { dot: 'bg-gray-300' };
  }
}

function isChanged(issue: AuditIssue | ChangedIssue): issue is ChangedIssue {
  return 'diffs' in issue && Boolean((issue as ChangedIssue).diffs);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value.trim() === '') return '—';
  return String(value);
}

function SeverityChip({ severity }: { severity: AuditIssue['severity'] }) {
  const styles: Record<AuditIssue['severity'], string> = {
    High: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    Medium: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    Low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[severity]}`}>
      {severity}
    </span>
  );
}

function FieldDiffList({ diffs }: { diffs: ChangedIssue['diffs'] }) {
  const entries = Object.entries(diffs) as [DiffableIssueField, IssueFieldDiff][];
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
      {entries.map(([field, diff]) => (
        <li
          key={field}
          className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          title={FIELD_LABELS[field]}
        >
          <span className="font-medium">{FIELD_LABELS[field]}:</span>
          <span className="text-gray-600 line-through dark:text-gray-400">{formatValue(diff.from)}</span>
          <span>→</span>
          <span className="font-medium">{formatValue(diff.to)}</span>
        </li>
      ))}
    </ul>
  );
}

function ComparisonRow({
  bucket,
  issue,
  onOpenEvidence,
}: {
  bucket: BucketKey;
  issue: AuditIssue | ChangedIssue;
  onOpenEvidence: () => void;
}) {
  const diffs = isChanged(issue) ? issue.diffs : null;
  const tone = toneForBucket(bucket);
  return (
    <div className="flex items-start gap-3 p-3 text-sm">
      <span
        aria-hidden="true"
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <SeverityChip severity={issue.severity} />
          <span className="font-medium text-gray-900 dark:text-gray-100">{issue.projectNo}</span>
          <span className="text-gray-600 dark:text-gray-300">{issue.projectName}</span>
          <span className="text-xs text-gray-400">· {issue.sheetName}</span>
          {issue.projectManager ? (
            <span className="text-xs text-gray-500">· {issue.projectManager}</span>
          ) : null}
        </div>
        {issue.reason ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{issue.reason}</p>
        ) : null}
        {diffs ? <FieldDiffList diffs={diffs} /> : null}
      </div>
      <button
        type="button"
        onClick={onOpenEvidence}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-brand hover:bg-brand/5"
        title="Jump to this issue in the workspace"
      >
        Open evidence <ExternalLink size={11} />
      </button>
    </div>
  );
}

export function ComparisonRows({
  bucket,
  rows,
  totalInBucket,
  onOpenEvidence,
}: {
  bucket: BucketKey;
  rows: (AuditIssue | ChangedIssue)[];
  totalInBucket: number;
  onOpenEvidence: (issue: AuditIssue) => void;
}) {
  if (rows.length === 0) {
    const message =
      totalInBucket === 0
        ? emptyMessageForBucket(bucket)
        : 'No rows match the current filter.';
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900">
        {message}
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-gray-900">
      {rows.map((issue) => (
        <ComparisonRow
          key={`${bucket}:${issue.issueKey ?? issue.id}`}
          bucket={bucket}
          issue={issue}
          onOpenEvidence={() => onOpenEvidence(issue)}
        />
      ))}
    </div>
  );
}

export type { BucketKey };
