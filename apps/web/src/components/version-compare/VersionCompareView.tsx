import { useCallback, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { AuditIssue, AuditVersion, ChangedIssue } from '@ses/domain';
import { buildIssuesCsv, compareResults } from '../../lib/domain/auditEngine';
import type { AuditProcess } from '../../lib/domain/types';
import { buildAlignedCompareRows } from '../../lib/versionCompareAlign';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import { PageHeader } from '../shared/PageHeader';
import {
  VersionCompareSideBySide,
  VersionCompareToolbar,
  type CompareViewFilter,
} from './VersionComparePanels';

export function VersionCompareView({
  process,
  activeFileId,
  onOpenIssue,
  showTitle = true,
}: {
  process: AuditProcess;
  activeFileId?: string | undefined;
  onOpenIssue: (issue: AuditIssue) => void;
  showTitle?: boolean;
}) {
  const versionsByFile = useMemo(() => {
    const map = new Map<string, AuditVersion[]>();
    for (const version of process.versions) {
      const key = version.result.fileId;
      const list = map.get(key) ?? [];
      list.push(version);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return map;
  }, [process.versions]);

  const fileGroups = useMemo(() => {
    const entries: Array<{ fileId: string; label: string; versions: AuditVersion[] }> = [];
    for (const [fileId, versions] of versionsByFile.entries()) {
      const file = process.files.find((f) => f.id === fileId);
      const label = file?.name ?? versions[0]?.versionName ?? fileId;
      entries.push({ fileId, label, versions });
    }
    return entries;
  }, [process.files, versionsByFile]);

  const allVersions = useMemo(() => {
    const flat = process.versions.slice();
    flat.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return flat;
  }, [process.versions]);

  const hasSameFileGroup = fileGroups.some((g) => g.versions.length >= 2);
  const initialGroup =
    fileGroups.find((g) => g.fileId === activeFileId) ??
    fileGroups.find((g) => g.versions.length >= 2) ??
    fileGroups[0];

  const [selectedFileId, setSelectedFileId] = useState<string>(initialGroup?.fileId ?? '');

  // Follow the `activeFileId` prop when it changes to a valid group, without
  // an effect: adjust state during render via the previous-value pattern.
  const [prevActiveFileId, setPrevActiveFileId] = useState(activeFileId);
  if (activeFileId !== prevActiveFileId) {
    setPrevActiveFileId(activeFileId);
    if (activeFileId && fileGroups.some((g) => g.fileId === activeFileId)) {
      setSelectedFileId(activeFileId);
    }
  }

  const activeGroup = fileGroups.find((g) => g.fileId === selectedFileId) ?? initialGroup;
  const pickerVersions = hasSameFileGroup ? (activeGroup?.versions ?? []) : allVersions;
  const headVersionId = pickerVersions[0]?.versionId ?? pickerVersions[0]?.id;

  const [fromId, setFromId] = useState<string>(
    () => pickerVersions[1]?.versionId ?? pickerVersions[0]?.versionId ?? '',
  );
  const [toId, setToId] = useState<string>(() => pickerVersions[0]?.versionId ?? '');
  const [viewFilter, setViewFilter] = useState<CompareViewFilter>('changed-only');

  // When the active file group changes, re-seed the from/to selection if the
  // current ids no longer belong to that group. Done at render time (not in an
  // effect) keyed on the group id so it runs exactly once per group switch.
  const [prevGroupId, setPrevGroupId] = useState(activeGroup?.fileId);
  if (hasSameFileGroup && activeGroup && activeGroup.fileId !== prevGroupId) {
    setPrevGroupId(activeGroup.fileId);
    const versions = activeGroup.versions;
    if (!versions.find((v) => v.versionId === fromId || v.id === fromId)) {
      setFromId(versions[1]?.versionId ?? versions[0]?.versionId ?? '');
    }
    if (!versions.find((v) => v.versionId === toId || v.id === toId)) {
      setToId(versions[0]?.versionId ?? '');
    }
  }

  const fromVersion = pickerVersions.find((v) => v.versionId === fromId || v.id === fromId);
  const toVersion = pickerVersions.find((v) => v.versionId === toId || v.id === toId);

  const comparison = useMemo(
    () => (fromVersion && toVersion ? compareResults(fromVersion.result, toVersion.result) : null),
    [fromVersion, toVersion],
  );

  const alignedRows = useMemo(() => {
    if (!comparison || !fromVersion) return [];
    return buildAlignedCompareRows(comparison, fromVersion);
  }, [comparison, fromVersion]);

  const visibleRows = useMemo(() => {
    if (viewFilter === 'all') return alignedRows;
    return alignedRows.filter((row) => row.state !== 'same');
  }, [alignedRows, viewFilter]);

  const swap = useCallback(() => {
    setFromId((prevFrom) => {
      const prevTo = toId;
      setToId(prevFrom);
      return prevTo;
    });
  }, [toId]);

  const exportDiff = useCallback(() => {
    if (!comparison || !fromVersion || !toVersion) return;
    const sections: string[] = [];
    const buckets: Array<{ label: string; rows: (AuditIssue | ChangedIssue)[] }> = [
      { label: 'New', rows: comparison.newIssues },
      { label: 'Fixed', rows: comparison.resolvedIssues },
      { label: 'Changed', rows: comparison.changedIssues },
      { label: 'Unchanged', rows: comparison.unchangedIssues },
    ];
    for (const { label, rows } of buckets) {
      if (!rows.length) continue;
      sections.push(`# ${label} (${rows.length})`);
      sections.push(buildIssuesCsv(rows));
    }
    const blob = new Blob([sections.join('\n\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fromVersion.versionName}--${toVersion.versionName}-diff.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [comparison, fromVersion, toVersion]);

  if (!process.versions.length) {
    return (
      <EmptyState title="No saved audit versions">
        Run an audit and save a version to compare changes between saves.
      </EmptyState>
    );
  }

  if (allVersions.length < 2) {
    return (
      <EmptyState title="Only one saved version">
        Save at least two audit versions to compare them side by side.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      {showTitle ? (
        <PageHeader
          title="Compare versions"
          description="Compare two saved versions of this workbook's audit run."
          className="mb-0"
          actions={
            <Button
              variant="secondary"
              leading={<Download size={14} />}
              onClick={exportDiff}
              disabled={!comparison}
            >
              Export diff
            </Button>
          }
        />
      ) : null}

      {hasSameFileGroup && fileGroups.length > 1 ? (
        <div className="surface-card p-4">
          <div className="eyebrow mb-2">File</div>
          <div className="flex flex-wrap gap-2">
            {fileGroups.map((g) => (
              <button
                key={g.fileId}
                type="button"
                onClick={() => setSelectedFileId(g.fileId)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-all ease-soft active:scale-[0.98] ${
                  g.fileId === selectedFileId
                    ? 'border-brand bg-brand/10 text-brand shadow-soft'
                    : 'border-rule text-ink-2 shadow-soft hover:border-brand/30 dark:border-gray-700'
                }`}
              >
                {g.label}{' '}
                <span className="text-xs tabular-nums text-ink-3">· {g.versions.length}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!hasSameFileGroup ? (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-2.5 text-sm text-warning-800 shadow-soft dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Comparing versions from different files — findings are matched by project number and rule, not by file.
        </div>
      ) : null}

      {comparison && fromVersion && toVersion ? (
        <>
          <VersionCompareToolbar
            fromVersion={fromVersion}
            toVersion={toVersion}
            fromOptions={pickerVersions}
            toOptions={pickerVersions}
            headVersionId={headVersionId}
            viewFilter={viewFilter}
            onFromChange={setFromId}
            onToChange={setToId}
            onViewFilterChange={setViewFilter}
            onSwap={swap}
            newCount={comparison.newIssues.length}
            fixedCount={comparison.resolvedIssues.length}
            unchangedCount={comparison.unchangedIssues.length}
            ownerChangeCount={comparison.managerChanges.length}
          />

          <VersionCompareSideBySide
            fromVersion={fromVersion}
            toVersion={toVersion}
            headVersionId={headVersionId}
            rows={visibleRows}
            onOpenIssue={onOpenIssue}
          />
        </>
      ) : null}
    </div>
  );
}
