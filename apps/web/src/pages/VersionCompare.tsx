import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, ArrowRightLeft, Download } from 'lucide-react';
import {
  DEFAULT_FUNCTION_ID,
  getFunctionLabel,
  isFunctionId,
  type AuditIssue,
  type AuditVersion,
  type ChangedIssue,
  type ComparisonResult,
  type FunctionId,
} from '@ses/domain';
import { buildIssuesCsv, compareResults, exportIssuesCsv } from '../lib/auditEngine';
import { workspacePath } from '../lib/processRoutes';
import { useAppStore } from '../store/useAppStore';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { EmptyState } from '../components/shared/EmptyState';
import { VersionCard } from '../components/workspace/version-compare/VersionCard';
import { matchesQuery, type BucketKey } from '../components/workspace/version-compare/ComparisonRows';
import { ComparisonPanel } from '../components/workspace/version-compare/ComparisonPanel';

const BUCKET_LABELS: Record<BucketKey, string> = {
  newIssues: 'New',
  changedIssues: 'Changed',
  resolvedIssues: 'Resolved',
  unchangedIssues: 'Unchanged',
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

  // Sensible defaults: first file group, previous → latest. Respect URL if
  // present so share links survive.
  const urlFileId = searchParams.get('file');
  const urlFromId = searchParams.get('from');
  const urlToId = searchParams.get('to');
  const initialGroup = fileGroups.find((g) => g.fileId === urlFileId) ?? fileGroups[0];
  const [selectedFileId, setSelectedFileId] = useState<string>(initialGroup?.fileId ?? '');
  const activeGroup = fileGroups.find((g) => g.fileId === selectedFileId) ?? initialGroup;

  const [fromId, setFromId] = useState<string>(() => {
    const versions = activeGroup?.versions ?? [];
    return urlFromId ?? versions[1]?.versionId ?? versions[0]?.versionId ?? '';
  });
  const [toId, setToId] = useState<string>(() => {
    const versions = activeGroup?.versions ?? [];
    return urlToId ?? versions[0]?.versionId ?? '';
  });

  // Re-seed selections when the file group changes so users never end up
  // comparing versions from different files.
  useEffect(() => {
    if (!activeGroup) return;
    const versions = activeGroup.versions;
    if (!versions.find((v) => v.versionId === fromId)) {
      setFromId(versions[1]?.versionId ?? versions[0]?.versionId ?? '');
    }
    if (!versions.find((v) => v.versionId === toId)) {
      setToId(versions[0]?.versionId ?? '');
    }
  }, [activeGroup, fromId, toId]);

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

  const fromVersion = activeGroup?.versions.find((v) => v.versionId === fromId || v.id === fromId);
  const toVersion = activeGroup?.versions.find((v) => v.versionId === toId || v.id === toId);

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
            { label: process.name, to: `/processes/${encodeURIComponent(process.displayCode ?? process.id)}` },
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
  const filteredRows = query ? allRows.filter((issue) => matchesQuery(issue, query)) : allRows;

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

  if (!activeGroup || activeGroup.versions.length < 2) {
    return (
      <AppShell process={process}>
        <div className="mx-auto max-w-3xl space-y-4 p-5">
          <Link to={workspacePath(process.id, functionId)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
            <ArrowLeft size={14} /> Back to {getFunctionLabel(functionId)}
          </Link>
          <EmptyState title="Only one saved version for this file">
            Run another audit on the same file (or save as a new version) to see a comparison. If you have multiple files, switch between them below.
          </EmptyState>
          {fileGroups.length > 1 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 font-medium">Files with saved versions</div>
              <ul className="space-y-1">
                {fileGroups.map((g) => (
                  <li key={g.fileId}>
                    <button
                      type="button"
                      onClick={() => setSelectedFileId(g.fileId)}
                      className={`rounded-md px-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        g.fileId === selectedFileId ? 'text-brand' : 'text-gray-700 dark:text-gray-200'
                      }`}
                    >
                      {g.label} ({g.versions.length} version{g.versions.length === 1 ? '' : 's'})
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell process={process}>
      <div className="mx-auto w-full max-w-6xl space-y-5 p-5">
        <h1 className="text-xl font-semibold">Version Compare · {getFunctionLabel(functionId)}</h1>

        {fileGroups.length > 1 ? (
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

        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          <VersionCard
            label="Previous"
            version={fromVersion}
            options={activeGroup.versions}
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
            options={activeGroup.versions}
            onChange={setToId}
            onOpenWorkspace={() => openInWorkspace(toVersion?.versionId ?? toVersion?.id)}
          />
        </div>

        {comparison ? (
          <ComparisonPanel
            comparison={comparison}
            summary={summary}
            bucket={bucket}
            onBucketChange={setBucket}
            query={query}
            onQueryChange={setQuery}
            filteredRows={filteredRows}
            allRows={allRows}
            onExportCsv={exportCsv}
            onOpenEvidence={openEvidence}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

// Typing helper — exposes ComparisonResult for the `.filter` call to narrow correctly.
export type { ComparisonResult };
