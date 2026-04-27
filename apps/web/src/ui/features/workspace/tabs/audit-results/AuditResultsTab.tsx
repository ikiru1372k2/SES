/**
 * AuditResultsTab — orchestrator component (~250 lines).
 *
 * Owns state (filters, sort, expansion, deep-link highlight) and delegates
 * rendering to AuditSummaryStrip, AuditFilterBar, and AuditIssueTable.
 *
 * Props interface is identical to the original monolithic component so
 * all call-sites continue to work unchanged.
 */
import { CheckCircle2, Circle, Settings } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  getFunctionLabel,
  isFunctionId,
  MD_COLUMNS,
  MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE,
  MD_REQUIRED_COLUMNS,
  MD_REVIEW_OTHERS_RULE_CODE,
} from '@ses/domain';
import { useKeyboardShortcut } from '../../../../../hooks/useKeyboardShortcut';
import { isPolicyChanged, policySummary } from '../../../../../lib/auditPolicy';
import { useDebouncedValue } from '../../../../../hooks/useDebouncedValue';
import { useAppStore } from '../../../../../store/useAppStore';
import { Badge } from '../../../../../components/shared/Badge';
import { EmptyState } from '../../../../../components/shared/EmptyState';
import { MappingSourcePanel } from '../../../../../components/workspace/MappingSourcePanel';
import type { MappingSourceInput } from '../../../../../lib/api/auditsApi';
import type { AuditIssue, AuditProcess, IssueCategory, WorkbookFile } from '../../../../../lib/types';
import { AuditSummaryStrip } from './AuditSummaryStrip';
import { AuditFilterBar } from './AuditFilterBar';
import { AuditIssueTable } from './AuditIssueTable';
import { QgcSettingsDrawer } from './QgcSettingsDrawer';
import type { SortKey } from './AuditFilterBar';

// ---------------------------------------------------------------------------
// Module-scope constants (no magic strings duplicated across files)
// ---------------------------------------------------------------------------
const MAPPING_ENABLED_FUNCTIONS: ReadonlySet<string> = new Set([
  'over-planning',
  'function-rate',
  'internal-cost-rate',
]);

const CATEGORY_OPTIONS: IssueCategory[] = [
  'Overplanning',
  'Missing Planning',
  'Data Quality',
  'Needs Review',
  'Other',
];

const ALL_ISSUE_HEADERS: Array<{ key: SortKey; label: string }> = [
  { key: 'severity', label: 'Severity' },
  { key: 'projectNo', label: 'Project No' },
  { key: 'projectName', label: 'Project' },
  { key: 'projectManager', label: 'Manager' },
  { key: 'email', label: 'Email' },
  { key: 'sheetName', label: 'Sheet' },
  { key: 'projectState', label: 'State' },
  { key: 'effort', label: 'Effort' },
  { key: 'reason', label: 'Issue' },
];

const MD_RULE_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'missing', label: 'Missing' },
  { value: 'not_assigned', label: 'Not assigned' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function visibleHeaders(functionId: string | undefined) {
  if (functionId === 'master-data') return ALL_ISSUE_HEADERS.filter((h) => h.key !== 'effort');
  return ALL_ISSUE_HEADERS;
}

function masterDataColumnLabel(ruleCode: string | null | undefined): string | null {
  if (!ruleCode) return null;
  for (const col of Object.values(MD_COLUMNS)) {
    if (ruleCode.startsWith(`RUL-MD-${col.id.toUpperCase()}-`)) return col.label;
  }
  return null;
}

function matchesMasterDataRuleFilter(ruleCode: string, filter: string): boolean {
  if (filter === 'not_assigned') return ruleCode === MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE;
  if (filter === 'other') return ruleCode === MD_REVIEW_OTHERS_RULE_CODE;
  if (filter === 'missing') {
    return (
      ruleCode !== MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE &&
      ruleCode !== MD_REVIEW_OTHERS_RULE_CODE &&
      ruleCode.endsWith('-MISSING')
    );
  }
  return true;
}

function issueRuleKey(issue: AuditIssue): string {
  return issue.ruleCode ?? issue.ruleId ?? issue.auditStatus ?? '';
}

function isMappingSourceValid(src: MappingSourceInput | undefined): boolean {
  if (!src || src.type === 'none') return true;
  if (src.type === 'master_data_version') return Boolean(src.masterDataVersionId);
  if (src.type === 'uploaded_file') return Boolean(src.uploadId);
  return true;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface AuditResultsTabProps {
  process: AuditProcess;
  file?: WorkbookFile | undefined;
  mappingSource?: MappingSourceInput | undefined;
  onMappingSourceChange?: (src: MappingSourceInput | undefined) => void;
  canEdit?: boolean;
  readOnlyReason?: string | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AuditResultsTab({
  process,
  file,
  mappingSource,
  onMappingSourceChange,
  canEdit = true,
  readOnlyReason,
}: AuditResultsTabProps) {
  const editTooltip = !canEdit ? readOnlyReason : undefined;

  const liveResult = useAppStore((state) => state.currentAuditResult);
  const runAudit = useAppStore((state) => state.runAudit);

  const result = useMemo(() => {
    if (!file) return null;
    if (liveResult && liveResult.fileId === file.id) return liveResult;
    if (process.latestAuditResult && process.latestAuditResult.fileId === file.id)
      return process.latestAuditResult;
    const latestVersion = process.versions?.[0]?.result;
    if (latestVersion && latestVersion.fileId === file.id) return latestVersion;
    return null;
  }, [liveResult, file, process.latestAuditResult, process.versions]);

  // Filter state
  const [severity, setSeverity] = useState('');
  const [sheet, setSheet] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('severity');
  const [expanded, setExpanded] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardShortcut('/', () => searchRef.current?.focus(), Boolean(result));

  // Deep-link highlight
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightIssueKey = searchParams.get('issue');
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const scrollPerformedRef = useRef<string | null>(null);

  const attachHighlightRef = (node: HTMLTableRowElement | null) => {
    if (!node || !highlightedRowId) return;
    if (scrollPerformedRef.current === highlightedRowId) return;
    scrollPerformedRef.current = highlightedRowId;
    requestAnimationFrame(() => node.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  useEffect(() => {
    if (!highlightIssueKey || !result) return;
    const target = result.issues.find((issue) => issue.issueKey === highlightIssueKey);
    if (!target) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setHighlightedRowId(target.id);
    setFlashRowId(target.id);
    setSeverity('');
    setCategory('');
    setStatus('');
    setSearch('');
    setExpanded(target.id);
    /* eslint-enable react-hooks/set-state-in-effect */
    const next = new URLSearchParams(searchParams);
    next.delete('issue');
    setSearchParams(next, { replace: true });
  }, [highlightIssueKey, result, searchParams, setSearchParams]);

  useEffect(() => {
    if (!flashRowId) return;
    const t = window.setTimeout(() => setFlashRowId(null), 4000);
    return () => window.clearTimeout(t);
  }, [flashRowId]);

  // Derived values
  const functionId = isFunctionId(file?.functionId) ? file!.functionId : undefined;
  const functionLabel = functionId ? getFunctionLabel(functionId) : 'Audit';
  const isMasterData = functionId === 'master-data';
  const issueHeaders = useMemo(() => visibleHeaders(functionId), [functionId]);
  const policyChanged = Boolean(result && isPolicyChanged(process.auditPolicy, result.policySnapshot));
  const hasSelected = Boolean(file?.sheets.some((s) => s.status === 'valid' && s.isSelected));
  const overPlanningFiles = useMemo(
    () => process.files.filter((f) => f.functionId === file?.functionId),
    [process.files, file?.functionId],
  );
  const mappingSourceOk =
    !MAPPING_ENABLED_FUNCTIONS.has(file?.functionId ?? '') || isMappingSourceValid(mappingSource);

  const categoryFilterOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    if (!result) return [];
    if (isMasterData) return MD_REQUIRED_COLUMNS.map((col) => ({ value: col.label, label: col.label }));
    return CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }));
  }, [result, isMasterData]);

  const ruleFilterOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    if (!result) return [];
    if (isMasterData) return [...MD_RULE_FILTER_OPTIONS];
    const codes = new Set<string>();
    for (const issue of result.issues) {
      const key = issueRuleKey(issue);
      if (key) codes.add(key);
    }
    return [...codes].map((code) => ({ value: code, label: code }));
  }, [result, isMasterData]);

  const searchIndex = useMemo(
    () =>
      (result?.issues ?? []).map((issue) => ({
        issue,
        blob: [
          issue.severity, issue.projectNo, issue.projectName, issue.projectManager,
          issue.email ?? '', issue.sheetName, issue.projectState, issue.effort,
          issue.ruleName, issue.auditStatus, issue.category, issue.reason,
          issue.notes, issue.recommendedAction,
        ].join(' ').toLowerCase(),
      })),
    [result],
  );

  const debouncedSearch = useDebouncedValue(search, 200);
  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return searchIndex
      .filter(({ issue }) => !severity || issue.severity === severity)
      .filter(({ issue }) => !sheet || issue.sheetName === sheet)
      .filter(({ issue }) => {
        if (!status) return true;
        if (isMasterData) return matchesMasterDataRuleFilter(issueRuleKey(issue), status);
        return issueRuleKey(issue) === status;
      })
      .filter(({ issue }) => {
        if (!category) return true;
        if (isMasterData) return masterDataColumnLabel(issue.ruleCode ?? issue.ruleId) === category;
        return issue.category === category;
      })
      .filter(({ blob }) => !query || blob.includes(query))
      .map(({ issue }) => issue)
      .sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')));
  }, [searchIndex, severity, sheet, status, category, debouncedSearch, sort, isMasterData]);

  const sheets = result ? [...new Set(result.issues.map((i) => i.sheetName))] : [];

  const handleRunAudit = () => {
    if (!file) return;
    void runAudit(process.id, file.id, mappingSource ? { mappingSource } : undefined).catch(
      (err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Audit failed — please try again.');
      },
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-950 dark:text-white">Audit Results</h2>
            {functionId ? <Badge tone="blue">{functionLabel}</Badge> : null}
            {policyChanged && !isMasterData ? (
              <Badge tone="amber">Policy changed - re-run audit</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {result
              ? `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} found across ${result.sheets.length} audited sheet${result.sheets.length === 1 ? '' : 's'}.`
              : isMasterData
                ? 'Master Data audit flags rows where required fields are blank, null, "not assigned", or set to a placeholder, plus "Others" products that need manual review.'
                : policySummary(process.auditPolicy)}
          </p>
        </div>
        {!isMasterData ? (
          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            <Settings size={16} />
            QGC Settings
          </button>
        ) : null}
      </div>

      {!result ? (
        <EmptyState title="No audit run yet">
          <div className="space-y-1 text-left">
            <Step done={Boolean(file)}>Upload a workbook</Step>
            <Step done={hasSelected}>Select sheets in the sidebar</Step>
            <Step done={false}>{isMasterData ? 'Run Master Data audit' : 'Run audit with the QGC policy'}</Step>
            <Step done={false}>Save a version for traceability</Step>
          </div>
          {file ? (
            <>
              {MAPPING_ENABLED_FUNCTIONS.has(file.functionId ?? '') && process.displayCode && (
                <div className="mb-3 w-full max-w-sm text-left">
                  <MappingSourcePanel
                    processId={process.id}
                    processDisplayCode={process.displayCode}
                    auditFileId={file.id}
                    overPlanningFiles={overPlanningFiles}
                    value={mappingSource}
                    onChange={onMappingSourceChange ?? (() => {})}
                  />
                </div>
              )}
              <button
                onClick={handleRunAudit}
                disabled={!hasSelected || !mappingSourceOk || !canEdit}
                title={editTooltip}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Run Audit
              </button>
            </>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <AuditSummaryStrip result={result} process={process} />

          {/* Stale result warning */}
          {(() => {
            const staleReason = computeStaleReason(result, file);
            if (!staleReason) return null;
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                <div>
                  <div className="font-semibold">Stale audit result</div>
                  <div className="mt-1">{staleReason}</div>
                </div>
                {file ? (
                  <button
                    type="button"
                    onClick={handleRunAudit}
                    disabled={!hasSelected || !mappingSourceOk || !canEdit}
                    title={editTooltip}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    Re-run audit
                  </button>
                ) : null}
              </div>
            );
          })()}

          {/* Policy changed notice */}
          {policyChanged ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <div className="font-semibold">Policy used</div>
              <div className="mt-1 text-gray-600 dark:text-gray-300">
                {policySummary(result.policySnapshot ?? process.auditPolicy)}
              </div>
              <div className="mt-2">
                Settings were changed after this audit. Re-run audit to apply the latest QGC policy.
              </div>
            </div>
          ) : null}

          <AuditFilterBar
            result={result}
            file={file}
            process={process}
            filtered={filtered}
            isMasterData={isMasterData}
            sheet={sheet}
            severity={severity}
            category={category}
            status={status}
            search={search}
            categoryFilterOptions={categoryFilterOptions}
            ruleFilterOptions={ruleFilterOptions}
            sheets={sheets}
            onSheetChange={setSheet}
            onSeverityChange={setSeverity}
            onCategoryChange={setCategory}
            onStatusChange={setStatus}
            onSearchChange={setSearch}
            searchRef={searchRef}
          />

          <AuditIssueTable
            filtered={filtered}
            process={process}
            isMasterData={isMasterData}
            issueHeaders={issueHeaders}
            highlightedRowId={highlightedRowId}
            flashRowId={flashRowId}
            attachHighlightRef={attachHighlightRef}
            expanded={expanded}
            onExpandToggle={(id) => setExpanded(expanded === id ? '' : id)}
            onSortChange={setSort}
            canEdit={canEdit}
            editTooltip={editTooltip}
          />
        </>
      )}

      {settingsOpen ? (
        <QgcSettingsDrawer
          process={process}
          file={file}
          mappingSource={mappingSource}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------
function computeStaleReason(
  result: { fileId?: string; issues: AuditIssue[] },
  file: WorkbookFile | undefined,
): string | null {
  if (!result || !file) return null;
  if (result.fileId && result.fileId !== file.id) {
    return 'These results are from a previous file. Run the audit again to refresh them.';
  }
  if (file.functionId && result.issues.length > 0) {
    const rogue = result.issues.find((issue) => {
      const code = issue.ruleCode ?? issue.ruleId ?? '';
      if (!code) return false;
      if (file.functionId === 'master-data') return !code.startsWith('RUL-MD-');
      if (file.functionId === 'missing-plan') return !code.startsWith('RUL-MP-');
      if (file.functionId === 'function-rate') return !code.startsWith('RUL-FR-');
      if (file.functionId === 'opportunities') return !code.startsWith('RUL-OPP-');
      if (file.functionId === 'over-planning') {
        return (
          code.startsWith('RUL-MD-') ||
          code.startsWith('RUL-MP-') ||
          code.startsWith('RUL-FR-') ||
          code.startsWith('RUL-OPP-')
        );
      }
      return false;
    });
    if (rogue) {
      return `These findings were produced by another function's ruleset (${rogue.ruleCode}). Re-run the audit to apply the ${file.functionId} rules.`;
    }
  }
  return null;
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <div className="flex items-center gap-2">
      <Icon size={16} className={done ? 'text-green-600' : 'text-gray-400'} />
      {children}
    </div>
  );
}

// QgcSettingsDrawer is in ./QgcSettingsDrawer.tsx — re-exported from the index barrel.
