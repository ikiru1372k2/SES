import { Filter, Search } from 'lucide-react';
import type { AuditIssue, ChangedIssue, ComparisonResult } from '@ses/domain';
import { MetricCard } from '../../shared/MetricCard';
import { Button } from '../../shared/Button';
import { ComparisonRows, type BucketKey } from './ComparisonRows';

const BUCKET_LABELS: Record<BucketKey, string> = {
  newIssues: 'New',
  changedIssues: 'Changed',
  resolvedIssues: 'Resolved',
  unchangedIssues: 'Unchanged',
};

interface CompareSummary {
  severityBumps: number;
  managerReassignments: number;
  topManager: { name: string; count: number } | null;
}

interface ComparisonPanelProps {
  comparison: ComparisonResult;
  summary: CompareSummary | null;
  bucket: BucketKey;
  onBucketChange: (key: BucketKey) => void;
  query: string;
  onQueryChange: (value: string) => void;
  filteredRows: (AuditIssue | ChangedIssue)[];
  allRows: (AuditIssue | ChangedIssue)[];
  onExportCsv: () => void;
  onOpenEvidence: (issue: AuditIssue) => void;
}

export function ComparisonPanel({
  comparison,
  summary,
  bucket,
  onBucketChange,
  query,
  onQueryChange,
  filteredRows,
  allRows,
  onExportCsv,
  onOpenEvidence,
}: ComparisonPanelProps) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="New" value={comparison.newIssues.length} />
        <MetricCard label="Resolved" value={comparison.resolvedIssues.length} />
        <MetricCard label="Changed" value={comparison.changedIssues.length} />
        <MetricCard label="Unchanged" value={comparison.unchangedIssues.length} />
      </div>

      {summary ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Summary
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            <li>
              <span className="font-medium">{comparison.newIssues.length}</span> new ·{' '}
              <span className="font-medium">{comparison.resolvedIssues.length}</span> resolved ·{' '}
              <span className="font-medium">{comparison.changedIssues.length}</span> changed ·{' '}
              <span className="text-gray-500">{comparison.unchangedIssues.length} unchanged</span>
            </li>
            {summary.severityBumps > 0 ? (
              <li>
                <span className="font-medium">{summary.severityBumps}</span> severity bump
                {summary.severityBumps === 1 ? '' : 's'}
              </li>
            ) : null}
            {summary.managerReassignments > 0 ? (
              <li>
                <span className="font-medium">{summary.managerReassignments}</span> manager
                reassignment{summary.managerReassignments === 1 ? '' : 's'}
              </li>
            ) : null}
            {summary.topManager ? (
              <li>
                Most affected: <span className="font-medium">{summary.topManager.name}</span>{' '}
                (+{summary.topManager.count} new)
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(['newIssues', 'changedIssues', 'resolvedIssues', 'unchangedIssues'] as const).map((key) => {
          const count = comparison[key].length;
          return (
            <button
              key={key}
              onClick={() => onBucketChange(key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                bucket === key
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              {BUCKET_LABELS[key]}{' '}
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] ${
                  bucket === key
                    ? 'bg-brand/20 text-brand'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Filter in this bucket"
              aria-label="Filter rows"
              className="w-56 rounded-lg border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <Button
            variant="secondary"
            leading={<Filter size={14} />}
            onClick={onExportCsv}
            disabled={!allRows.length}
            title={allRows.length ? `Export ${BUCKET_LABELS[bucket]} (${allRows.length})` : 'Nothing to export'}
          >
            Export bucket
          </Button>
        </div>
      </div>

      <ComparisonRows
        bucket={bucket}
        rows={filteredRows}
        totalInBucket={allRows.length}
        onOpenEvidence={onOpenEvidence}
      />
    </>
  );
}
