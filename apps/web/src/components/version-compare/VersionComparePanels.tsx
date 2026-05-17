import type { ReactNode } from 'react';
import type { AuditIssue, AuditVersion } from '@ses/domain';
import { formatVersionPanelMeta } from '../../lib/versionCompareAlign';
import type { AlignedCompareRow, DiffViewState } from '../../lib/versionCompareAlign';

export type CompareViewFilter = 'all' | 'changed-only';

export function VersionCompareToolbar({
  fromVersion,
  toVersion,
  fromOptions,
  toOptions,
  headVersionId,
  viewFilter,
  onFromChange,
  onToChange,
  onViewFilterChange,
  onSwap,
  newCount,
  fixedCount,
  unchangedCount,
  ownerChangeCount,
}: {
  fromVersion: AuditVersion | undefined;
  toVersion: AuditVersion | undefined;
  fromOptions: AuditVersion[];
  toOptions: AuditVersion[];
  headVersionId: string | undefined;
  viewFilter: CompareViewFilter;
  onFromChange: (id: string) => void;
  onToChange: (id: string) => void;
  onViewFilterChange: (filter: CompareViewFilter) => void;
  onSwap: () => void;
  newCount: number;
  fixedCount: number;
  unchangedCount: number;
  ownerChangeCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <VersionSelect
        label="Version A"
        version={fromVersion}
        options={fromOptions}
        headVersionId={headVersionId}
        onChange={onFromChange}
      />
      <button
        type="button"
        onClick={onSwap}
        title="Swap versions"
        aria-label="Swap versions"
        className="mt-5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rule bg-white text-ink-3 shadow-soft hover:border-brand hover:text-brand dark:border-gray-700 dark:bg-gray-900"
      >
        ⇄
      </button>
      <VersionSelect
        label="Version B"
        version={toVersion}
        options={toOptions}
        headVersionId={headVersionId}
        onChange={onToChange}
      />
      <select
        value={viewFilter}
        onChange={(e) => onViewFilterChange(e.target.value as CompareViewFilter)}
        className="mt-5 h-9 rounded-lg border border-rule bg-white px-3 text-sm text-ink shadow-soft outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900"
        aria-label="Filter findings"
      >
        <option value="all">All findings</option>
        <option value="changed-only">Only changed</option>
      </select>
      <span className="mt-5 flex flex-1 flex-wrap items-center justify-end gap-2">
        <DiffPill tone="ok">+{newCount} new</DiffPill>
        <DiffPill tone="bad">−{fixedCount} fixed</DiffPill>
        <DiffPill tone="plain">{unchangedCount} unchanged</DiffPill>
        {ownerChangeCount > 0 ? (
          <DiffPill tone="info">{ownerChangeCount} owner change{ownerChangeCount === 1 ? '' : 's'}</DiffPill>
        ) : null}
      </span>
    </div>
  );
}

function VersionSelect({
  label,
  version,
  options,
  headVersionId,
  onChange,
}: {
  label: string;
  version: AuditVersion | undefined;
  options: AuditVersion[];
  headVersionId: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <label className="block min-w-[200px] flex-1 max-w-xs">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {label}
      </span>
      <select
        value={version?.versionId ?? version?.id ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-rule bg-white px-3 text-sm font-medium text-ink shadow-soft outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900"
      >
        {options.map((option) => {
          const id = option.versionId ?? option.id;
          const isHead = Boolean(headVersionId && id === headVersionId);
          const date = new Date(option.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          });
          return (
            <option key={option.id} value={id}>
              {option.versionName} · {date}
              {isHead ? ' (head)' : ''}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function VersionCompareSideBySide({
  fromVersion,
  toVersion,
  headVersionId,
  rows,
  onOpenIssue,
}: {
  fromVersion: AuditVersion | undefined;
  toVersion: AuditVersion | undefined;
  headVersionId: string | undefined;
  rows: AlignedCompareRow[];
  onOpenIssue: (issue: AuditIssue) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-rule-2 bg-white p-10 text-center text-sm text-ink-3 dark:border-gray-700 dark:bg-gray-900">
        No rows match the current filter.
      </div>
    );
  }

  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <ComparePanel
        title={`Version A · ${fromVersion?.versionName ?? '—'}`}
        meta={formatVersionPanelMeta(fromVersion)}
        side="a"
        rows={rows}
        onOpenIssue={onOpenIssue}
      />
      <ComparePanel
        title={`Version B · ${toVersion?.versionName ?? '—'}${
          isHeadVersion(toVersion, headVersionId) ? ' (head)' : ''
        }`}
        meta={formatVersionPanelMeta(toVersion)}
        side="b"
        rows={rows}
        onOpenIssue={onOpenIssue}
      />
    </div>
  );
}

function isHeadVersion(version: AuditVersion | undefined, headVersionId: string | undefined): boolean {
  if (!version || !headVersionId) return false;
  const id = version.versionId ?? version.id;
  return id === headVersionId;
}

function ComparePanel({
  title,
  meta,
  side,
  rows,
  onOpenIssue,
}: {
  title: string;
  meta: string;
  side: 'a' | 'b';
  rows: AlignedCompareRow[];
  onOpenIssue: (issue: AuditIssue) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-white shadow-soft dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-rule-2 bg-surface-app px-4 py-3 dark:border-gray-800 dark:bg-gray-950/50">
        <div className="text-[13px] font-bold text-ink dark:text-white">{title}</div>
        <div className="mt-0.5 text-[11.5px] text-ink-3">{meta}</div>
      </div>
      <div>
        {rows.map((row) => (
          <DiffRow key={`${side}:${row.key}`} row={row} side={side} onOpen={() => onOpenIssue(row.openIssue)} />
        ))}
      </div>
    </div>
  );
}

function DiffRow({
  row,
  side,
  onOpen,
}: {
  row: AlignedCompareRow;
  side: 'a' | 'b';
  onOpen: () => void;
}) {
  const text = side === 'a' ? row.left : row.right;
  const absent = text === null;
  const tone = rowTone(row.state, side);
  const bg = absent
    ? 'bg-[#fafafa] dark:bg-gray-950/40'
    : tone === 'ok'
      ? 'bg-success-50/80 dark:bg-emerald-950/30'
      : tone === 'bad'
        ? 'bg-danger-50/80 dark:bg-red-950/30'
        : tone === 'warn'
          ? 'bg-warning-50/80 dark:bg-amber-950/25'
          : row.state === 'same'
            ? 'bg-surface-app/80 dark:bg-gray-950/30'
            : 'bg-white dark:bg-gray-900';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`grid w-full grid-cols-[minmax(72px,88px)_1fr_auto] items-center gap-2 border-b border-rule-2 px-4 py-2 text-left text-[12.5px] last:border-b-0 dark:border-gray-800 ${bg} ${
        absent ? 'text-ink-3' : 'text-ink-2 dark:text-gray-300'
      } hover:brightness-[0.98]`}
    >
      <span className="font-mono text-[11px] text-ink-3">{row.code}</span>
      <span className={absent ? 'italic text-ink-3' : ''}>{absent ? '— not present —' : text}</span>
      <span className="flex justify-end">
        <StateChip state={row.state} side={side} />
      </span>
    </button>
  );
}

function rowTone(state: DiffViewState, side: 'a' | 'b'): 'ok' | 'bad' | 'warn' | 'plain' {
  if (state === 'new' && side === 'b') return 'ok';
  if (state === 'fixed' && side === 'a') return 'bad';
  if (state === 'changed') return 'warn';
  return 'plain';
}

function StateChip({ state, side }: { state: DiffViewState; side: 'a' | 'b' }) {
  if (state === 'new' && side === 'b') {
    return <DiffPill tone="ok">+ new</DiffPill>;
  }
  if (state === 'fixed' && side === 'a') {
    return <DiffPill tone="bad">− fixed</DiffPill>;
  }
  if (state === 'changed') {
    return <DiffPill tone="warn">~ changed</DiffPill>;
  }
  return <DiffPill tone="plain">same</DiffPill>;
}

function DiffPill({
  tone,
  children,
}: {
  tone: 'ok' | 'bad' | 'warn' | 'plain' | 'info';
  children: ReactNode;
}) {
  const cls =
    tone === 'ok'
      ? 'bg-success-50 text-success-800 dark:bg-emerald-950/50 dark:text-emerald-200'
      : tone === 'bad'
        ? 'bg-danger-50 text-danger-700 dark:bg-red-950/50 dark:text-red-300'
        : tone === 'warn'
          ? 'bg-warning-50 text-warning-800 dark:bg-amber-950/40 dark:text-amber-200'
          : tone === 'info'
            ? 'bg-brand-subtle text-brand dark:bg-brand/20'
            : 'bg-surface-app text-ink-2 ring-1 ring-inset ring-rule dark:bg-gray-800 dark:text-gray-300';

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}
