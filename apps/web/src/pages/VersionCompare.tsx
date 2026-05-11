import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, ArrowRightLeft, Download, ExternalLink, Filter, Search } from 'lucide-react';
import {
  DEFAULT_FUNCTION_ID,
  getFunctionLabel,
  isFunctionId,
  type AuditIssue,
  type AuditVersion,
  type ChangedIssue,
  type ComparisonResult,
  type DiffableIssueField,
  type FunctionId,
  type IssueFieldDiff,
} from '@ses/domain';
import { buildIssuesCsv, compareResults, exportIssuesCsv } from '../lib/auditEngine';
import { processDashboardPath, workspacePath } from '../lib/processRoutes';
import { useAppStore } from '../store/useAppStore';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { MetricCard } from '../components/shared/MetricCard';
import { EmptyState } from '../components/shared/EmptyState';
import { Button } from '../components/shared/Button';

type BucketKey = 'newIssues' | 'changedIssues' | 'resolvedIssues' | 'unchangedIssues';

const BUCKET_LABELS: Record<BucketKey, string> = {
  newIssues: 'New',
  changedIssues: 'Changed',
  resolvedIssues: 'Resolved',
  unchangedIssues: 'Unchanged',
};

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

const SEVERITY_RANK = { Low: 0, Medium: 1, High: 2 } as const;

export function VersionCompare() {
  const { processId: routeProcessId, id: legacyId, functionId: routeFunctionId } = useParams<{
    processId?: string;
    id?: string;
    functionId?: string;
  }>();
  const resolvedProcessId = routeProcessId ?? legacyId;
  const functionId: FunctionId =
    routeFunctionId && isFunctionId(routeFunctionId) ? routeFunctionId : DEFAULT_FUNCTION_ID;
  const process = useAppStore((state) =>
    resolvedProcessId
      ? state.processes.find((item) => item.id === resolvedProcessId || item.displayCode === resolvedProcessId)
      : undefined,
  );
  const loadVersion = useAppStore((state) => state.loadVersion);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Group versions by fileId so the picker steers users toward apples-to-apples
  // comparisons (C2 in the audit: cross-file comparisons produced nonsense).
  const versionsByFile = useMemo(() => {
    const map = new Map<string, AuditVersion[]>();
    for (const version of process?.versions ?? []) {
      const key = version.result.fileId;
      const list = map.get(key) ?? [];
      list.push(version);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return map;
  }, [process?.versions]);

  const fileGroups = useMemo(() => {
    const entries: Array<{ fileId: string; label: string; versions: AuditVersion[] }> = [];
    for (const [fileId, versions] of versionsByFile.entries()) {
      const file = process?.files.find((f) => f.id === fileId);
      const label = file?.name ?? versions[0]?.versionName ?? fileId;
      entries.push({ fileId, label, versions });
    }
    return entries;
  }, [process?.files, versionsByFile]);

  // Flat list of all versions across all files, sorted newest-first.
  // Used as picker options when the weekly workflow uploads a new file each
  // week — each file ends up with only one version, so per-file grouping
  // would block comparison entirely.
  const allVersions = useMemo(() => {
    const flat = (process?.versions ?? []).slice();
    flat.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return flat;
  }, [process?.versions]);

  // Whether any single file has ≥2 versions (same-file mode).
  const hasSameFileGroup = fileGroups.some((g) => g.versions.length >= 2);

  // Sensible defaults: first file group, previous → latest. Respect URL if
  // present so share links survive.
  const urlFileId = searchParams.get('file');
  const urlFromId = searchParams.get('from');
  const urlToId = searchParams.get('to');
  const initialGroup = fileGroups.find((g) => g.fileId === urlFileId) ?? fileGroups[0];
  const [selectedFileId, setSelectedFileId] = useState<string>(initialGroup?.fileId ?? '');
  const activeGroup = fileGroups.find((g) => g.fileId === selectedFileId) ?? initialGroup;

  // Picker options: same-file versions when available, otherwise all versions.
  const pickerVersions = hasSameFileGroup ? (activeGroup?.versions ?? []) : allVersions;

  const [fromId, setFromId] = useState<string>(() => {
    return urlFromId ?? pickerVersions[1]?.versionId ?? pickerVersions[0]?.versionId ?? '';
  });
  const [toId, setToId] = useState<string>(() => {
    return urlToId ?? pickerVersions[0]?.versionId ?? '';
  });

  // Re-seed selections when the file group changes (same-file mode only).
  useEffect(() => {
    if (!hasSameFileGroup || !activeGroup) return;
    const versions = activeGroup.versions;
    if (!versions.find((v) => v.versionId === fromId)) {
      setFromId(versions[1]?.versionId ?? versions[0]?.versionId ?? '');
    }
    if (!versions.find((v) => v.versionId === toId)) {
      setToId(versions[0]?.versionId ?? '');
    }
  }, [activeGroup, fromId, hasSameFileGroup, toId]);

  // Mirror selection into URL so the page is bookmarkable and share-safe.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedFileId) next.set('file', selectedFileId);
    if (fromId) next.set('from', fromId);
    if (toId) next.set('to', toId);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // `searchParams` left out intentionally; we only want to push on selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileId, fromId, toId]);

  const fromVersion = pickerVersions.find((v) => v.versionId === fromId || v.id === fromId);
  const toVersion = pickerVersions.find((v) => v.versionId === toId || v.id === toId);

  const [bucket, setBucket] = useState<BucketKey>('newIssues');
  const [query, setQuery] = useState('');

  const comparison = useMemo(
    () => (fromVersion && toVersion ? compareResults(fromVersion.result, toVersion.result) : null),
    [fromVersion, toVersion],
  );

  const summary = useMemo(() => {
    if (!comparison || !fromVersion) return null;
    const severityBumps = comparison.changedIssues.filter((issue) => {
      const prev = fromVersion.result.issues.find(
        (i) => (i.issueKey ?? i.id) === (issue.issueKey ?? issue.id),
      );
      if (!prev) return false;
      return (SEVERITY_RANK[issue.severity] ?? 0) > (SEVERITY_RANK[prev.severity] ?? 0);
    }).length;
    const managerReassignments = comparison.managerChanges.length;

    const managerImpact = new Map<string, number>();
    for (const issue of comparison.newIssues) {
      if (!issue.projectManager) continue;
      managerImpact.set(issue.projectManager, (managerImpact.get(issue.projectManager) ?? 0) + 1);
    }
    let topManager: { name: string; count: number } | null = null;
    for (const [name, count] of managerImpact.entries()) {
      if (!topManager || count > topManager.count) topManager = { name, count };
    }

    return { severityBumps, managerReassignments, topManager };
  }, [comparison, fromVersion]);

  const swap = useCallback(() => {
    setFromId((prevFrom) => {
      const prevTo = toId;
      setToId(prevFrom);
      return prevTo;
    });
  }, [toId]);

  const exportSummaryCallback = useCallback(() => {
    if (!comparison || !fromVersion || !toVersion) return;
    const sections: string[] = [];
    for (const key of ['newIssues', 'changedIssues', 'resolvedIssues', 'unchangedIssues'] as const) {
      const rows = comparison[key] as (AuditIssue | ChangedIssue)[];
      if (!rows.length) continue;
      sections.push(`# ${BUCKET_LABELS[key]} (${rows.length})`);
      sections.push(buildIssuesCsv(rows));
    }
    const blob = new Blob([sections.join('\n\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fromVersion.versionName}--${toVersion.versionName}-full.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [comparison, fromVersion, toVersion]);

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: process
        ? [
            { label: 'Dashboard', to: '/' },
            { label: process.name, to: processDashboardPath(process.displayCode ?? process.id) },
            { label: getFunctionLabel(functionId), to: workspacePath(process.displayCode ?? process.id, functionId) },
            { label: 'Compare' },
          ]
        : [],
      overflowActions: [
        { id: 'swap', label: 'Swap versions', icon: ArrowRightLeft, onClick: swap },
        { id: 'download-diff', label: 'Download diff CSV', icon: Download, onClick: exportSummaryCallback },
      ],
    }),
    [process, functionId, swap, exportSummaryCallback],
  );
  usePageHeader(headerConfig);

  if (!resolvedProcessId || !process) return <Navigate to="/" replace />;

  const allRows = (comparison?.[bucket] ?? []) as (AuditIssue | ChangedIssue)[];
  const filteredRows = query
    ? allRows.filter((issue) => matchesQuery(issue, query))
    : allRows;

  const exportCsv = () => {
    if (!comparison || !fromVersion || !toVersion) return;
    const label = `${fromVersion.versionName}--${toVersion.versionName}`.replace(/[^\w-]+/g, '_');
    exportIssuesCsv(`${label}--${bucket}.csv`, allRows);
  };

  const openInWorkspace = (versionId: string | undefined) => {
    if (!versionId) return;
    loadVersion(process.id, versionId);
    void navigate(workspacePath(process.displayCode ?? process.id, functionId) + '?tab=results');
  };

  const openEvidence = (issue: AuditIssue) => {
    const key = issue.issueKey ?? issue.id;
    if (!key) return;
    const path = workspacePath(process.displayCode ?? process.id, functionId);
    void navigate(`${path}?tab=results&issue=${encodeURIComponent(key)}`);
  };

  if (fileGroups.length === 0) {
    return (
      <AppShell process={process}>
        <div className="p-5">
          <EmptyState title="No saved versions yet">Save at least one audit version before comparing.</EmptyState>
        </div>
      </AppShell>
    );
  }

  if (allVersions.length < 2) {
    return (
      <AppShell process={process}>
        <div className="mx-auto max-w-3xl space-y-4 p-5">
          <Link to={workspacePath(process.id, functionId)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
            <ArrowLeft size={14} /> Back to {getFunctionLabel(functionId)}
          </Link>
          <EmptyState title="Only one saved version">
            Save at least two audit versions (from the same or different files) to compare them.
          </EmptyState>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell process={process}>
      <div className="mx-auto w-full max-w-6xl space-y-5 p-5">
        <h1 className="text-xl font-semibold">Version Compare · {getFunctionLabel(functionId)}</h1>

        {hasSameFileGroup && fileGroups.length > 1 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">File</div>
            <div className="flex flex-wrap gap-2">
              {fileGroups.map((g) => (
                <button
                  key={g.fileId}
                  type="button"
                  onClick={() => setSelectedFileId(g.fileId)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    g.fileId === selectedFileId
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:text-gray-200'
                  }`}
                >
                  {g.label} <span className="text-xs text-gray-500">· {g.versions.length}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!hasSameFileGroup ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Comparing versions from different files — issues are matched by project number and rule, not by file.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          <VersionCard
            label="Previous"
            version={fromVersion}
            options={pickerVersions}
            onChange={setFromId}
            onOpenWorkspace={() => openInWorkspace(fromVersion?.versionId ?? fromVersion?.id)}
          />
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={swap}
              title="Swap direction"
              className="rounded-full border border-gray-300 bg-white p-2 text-gray-600 shadow-sm transition hover:border-brand hover:text-brand dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              aria-label="Swap from/to"
            >
              <ArrowLeftRight size={16} />
            </button>
          </div>
          <VersionCard
            label="Latest"
            version={toVersion}
            options={pickerVersions}
            onChange={setToId}
            onOpenWorkspace={() => openInWorkspace(toVersion?.versionId ?? toVersion?.id)}
          />
        </div>

        {comparison ? (
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
                    onClick={() => setBucket(key)}
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
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter in this bucket"
                    aria-label="Filter rows"
                    className="w-56 rounded-lg border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                  />
                </div>
                <Button
                  variant="secondary"
                  leading={<Filter size={14} />}
                  onClick={exportCsv}
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
              onOpenEvidence={openEvidence}
            />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function matchesQuery(issue: AuditIssue, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${issue.projectNo} ${issue.projectName} ${issue.projectManager} ${issue.sheetName} ${issue.reason ?? ''} ${issue.recommendedAction ?? ''}`.toLowerCase();
  return haystack.includes(needle);
}

function VersionCard({
  label,
  version,
  options,
  onChange,
  onOpenWorkspace,
}: {
  label: string;
  version: AuditVersion | undefined;
  options: AuditVersion[];
  onChange: (id: string) => void;
  onOpenWorkspace: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <button
          type="button"
          onClick={onOpenWorkspace}
          disabled={!version}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-brand hover:bg-brand/5 disabled:opacity-40"
          title="Load this version in the workspace"
        >
          Open <ExternalLink size={11} />
        </button>
      </div>
      <select
        value={version?.versionId ?? version?.id ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-800"
      >
        {options.map((option) => (
          <option key={option.id} value={option.versionId ?? option.id}>
            {option.versionName}
          </option>
        ))}
      </select>
      {version ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span>{new Date(version.createdAt).toLocaleString()}</span>
          <span>·</span>
          <span>{version.result.issues.length} issues</span>
          {version.notes ? (
            <span className="line-clamp-1 text-gray-400" title={version.notes}>
              — {version.notes}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ComparisonRows({
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

function emptyMessageForBucket(bucket: BucketKey): string {
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

function isChanged(issue: AuditIssue | ChangedIssue): issue is ChangedIssue {
  return 'diffs' in issue && Boolean((issue as ChangedIssue).diffs);
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

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value.trim() === '') return '—';
  return String(value);
}

// Typing helper — exposes ComparisonResult for the `.filter` call to narrow correctly.
export type { ComparisonResult };
