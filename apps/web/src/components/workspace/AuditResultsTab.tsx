import { CheckCircle2, ChevronRight, Circle, Settings, X } from 'lucide-react';
import { AiBadge } from '../ai-pilot/AiBadge';
import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { MappingSourceInput } from '../../lib/api/auditsApi';
import { MappingSourcePanel } from './MappingSourcePanel';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import {
  getFunctionLabel,
  isFunctionId,
  MD_COLUMNS,
  MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE,
  MD_REQUIRED_COLUMNS,
  MD_REVIEW_OTHERS_RULE_CODE,
} from '@ses/domain';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { escalationCenterPath } from '../../lib/processRoutes';
import { createDefaultAuditPolicy, isPolicyChanged, policySummary } from '../../lib/domain/auditPolicy';
import { auditIssueKey, exportIssuesCsv } from '../../lib/domain/auditEngine';
import { openAuditReport } from '../../lib/reportExporter';
import { severityTone } from '../../lib/domain/severity';
import type {
  AcknowledgmentStatus,
  AuditPolicy,
  AuditProcess,
  AuditIssue,
  IssueCategory,
  IssueComment,
  IssueCorrection,
  WorkbookFile,
} from '../../lib/domain/types';
import { selectIssueComments, selectIssueCorrection } from '../../store/selectors';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import { MetricCard } from '../shared/MetricCard';
import { StatusBadge } from '../shared/StatusBadge';

type SortKey = keyof Pick<AuditIssue, 'severity' | 'projectNo' | 'projectName' | 'projectManager' | 'email' | 'sheetName' | 'projectState' | 'effort' | 'reason'>;

const categoryOptions: IssueCategory[] = [
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

// Master Data findings have no effort hours — every issue is effort: 0, so hide the column.
function visibleIssueHeaders(functionId: string | undefined): Array<{ key: SortKey; label: string }> {
  if (functionId === 'master-data') return ALL_ISSUE_HEADERS.filter((h) => h.key !== 'effort');
  return ALL_ISSUE_HEADERS;
}

// Map a master-data rule code to the source column's user-facing label.
// Returns null for codes that don't belong to any MD column.
function masterDataColumnLabel(ruleCode: string | null | undefined): string | null {
  if (!ruleCode) return null;
  for (const col of Object.values(MD_COLUMNS)) {
    if (ruleCode.startsWith(`RUL-MD-${col.id.toUpperCase()}-`)) return col.label;
  }
  return null;
}

// Collapses MD's many rule codes into three semantic options; combined with
// the Column filter for drill-down.
const MD_RULE_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'missing',      label: 'Missing' },
  { value: 'not_assigned', label: 'Not assigned' },
  { value: 'other',        label: 'Other' },
];

function matchesMasterDataRuleFilter(ruleCode: string, filter: string): boolean {
  if (filter === 'not_assigned') return ruleCode === MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE;
  if (filter === 'other') return ruleCode === MD_REVIEW_OTHERS_RULE_CODE;
  // 'missing' covers all RUL-MD-<COLUMN>-MISSING codes; explicitly excludes
  // NOT-ASSIGNED / REVIEW-OTHERS to avoid overlap.
  if (filter === 'missing') {
    return (
      ruleCode !== MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE &&
      ruleCode !== MD_REVIEW_OTHERS_RULE_CODE &&
      ruleCode.endsWith('-MISSING')
    );
  }
  return true;
}

// Authoritative rule-code key. Server-backed runs put the code on ruleCode/ruleId
// (auditStatus is ''); reading auditStatus first emptied the dropdown for them.
function issueRuleKey(issue: AuditIssue): string {
  return issue.ruleCode ?? issue.ruleId ?? issue.auditStatus ?? '';
}

function isMappingSourceValid(src: MappingSourceInput | undefined): boolean {
  if (!src || src.type === 'none') return true;
  if (src.type === 'master_data_version') return Boolean(src.masterDataVersionId);
  if (src.type === 'uploaded_file') return Boolean(src.uploadId);
  return true;
}

// Module-scope so refs in render/effects don't churn.
const MAPPING_ENABLED_FUNCTIONS: ReadonlySet<string> = new Set([
  'over-planning',
  'function-rate',
  'internal-cost-rate',
]);

export function AuditResultsTab({
  process,
  file,
  mappingSource,
  onMappingSourceChange,
  canEdit = true,
  readOnlyReason,
}: {
  process: AuditProcess;
  file?: WorkbookFile | undefined;
  mappingSource?: MappingSourceInput | undefined;
  onMappingSourceChange?: (src: MappingSourceInput | undefined) => void;
  /** When false, Run/Re-run/comment/correction/acknowledgment are disabled. Defaults to true. */
  canEdit?: boolean;
  /** Tooltip shown on disabled mutating controls. */
  readOnlyReason?: string | undefined;
}) {
  const editTooltip = !canEdit ? readOnlyReason : undefined;
  // currentAuditResult is per-session and cleared on navigation, so when the
  // user deep-links here from Escalation Center it's null. Fall back to the
  // process-level cached result, then the most recent saved version.
  const liveResult = useAppStore((state) => state.currentAuditResult);
  const result = useMemo(() => {
    if (!file) return null;
    if (liveResult && liveResult.fileId === file.id) return liveResult;
    if (process.latestAuditResult && process.latestAuditResult.fileId === file.id) {
      return process.latestAuditResult;
    }
    // process.versions is newest-first; index 0 is latest.
    const latestVersion = process.versions?.[0]?.result;
    if (latestVersion && latestVersion.fileId === file.id) return latestVersion;
    return null;
  }, [liveResult, file, process.latestAuditResult, process.versions]);
  const runAudit = useAppStore((state) => state.runAudit);
  const addIssueComment = useAppStore((state) => state.addIssueComment);
  const deleteIssueComment = useAppStore((state) => state.deleteIssueComment);
  const saveIssueCorrection = useAppStore((state) => state.saveIssueCorrection);
  const clearIssueCorrection = useAppStore((state) => state.clearIssueCorrection);
  const setIssueAcknowledgment = useAppStore((state) => state.setIssueAcknowledgment);
  const [severity, setSeverity] = useState('');
  const [sheet, setSheet] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('severity');
  const [expanded, setExpanded] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mapping-file candidates: sibling files sharing this functionId.
  const overPlanningFiles = useMemo(
    () => process.files.filter((f) => f.functionId === file?.functionId),
    [process.files, file?.functionId],
  );
  const mappingSourceOk =
    !MAPPING_ENABLED_FUNCTIONS.has(file?.functionId ?? '') || isMappingSourceValid(mappingSource);
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardShortcut('/', () => searchRef.current?.focus(), Boolean(result));
  const policyChanged = Boolean(result && isPolicyChanged(process.auditPolicy, result.policySnapshot));

  // Deep-link (?issue=<issueKey>) handling: find row, clear filters, expand,
  // scroll, flash. Uses a callback ref because the row mounts asynchronously
  // (after expand) and an effect would see ref.current === null.
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightIssueKey = searchParams.get('issue');
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const scrollPerformedRef = useRef<string | null>(null);

  // Scroll once per deep-link target. Must use element.scrollIntoView (not
  // window.scrollTo): the scroll container is a flex child of <main> with
  // overflow-y-auto (see TabPanel.tsx), so window itself doesn't scroll.
  const attachHighlightRef = (node: HTMLTableRowElement | null) => {
    if (!node || !highlightedRowId) return;
    if (scrollPerformedRef.current === highlightedRowId) return;
    scrollPerformedRef.current = highlightedRowId;
    // Wait a frame so the expanded detail mounts and counts in scroll bounds.
    requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  useEffect(() => {
    if (!highlightIssueKey || !result) return;
    const target = result.issues.find((issue) => issue.issueKey === highlightIssueKey);
    if (!target) return;
    // One-shot effect consuming `?issue=` from URL; set-state-in-effect rule N/A.
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

  // Auto-dismiss the amber flash; keep the row expanded.
  useEffect(() => {
    if (!flashRowId) return;
    const t = window.setTimeout(() => setFlashRowId(null), 4000);
    return () => window.clearTimeout(t);
  }, [flashRowId]);

  // Detect stale result (different file, or rule codes from another function's
  // engine — legacy pre-split runs). Surface a banner rather than mislead.
  const staleReason: string | null = (() => {
    if (!result || !file) return null;
    if (result.fileId && result.fileId !== file.id) {
      return 'These results are from a previous file. Run the audit again to refresh them.';
    }
    if (file.functionId && result.issues.length > 0) {
      const prefixFor = (fid: string): string => {
        if (fid === 'master-data') return 'RUL-MD-';
        if (fid === 'missing-plan') return 'RUL-MP-';
        if (fid === 'function-rate') return 'RUL-FR-';
        if (fid === 'opportunities') return 'RUL-OPP-';
        if (fid === 'over-planning') return 'RUL-';
        return '';
      };
      const expectedPrefix = prefixFor(file.functionId);
      const rogue = result.issues.find((issue) => {
        const code = issue.ruleCode ?? issue.ruleId ?? '';
        if (!code) return false;
        if (file.functionId === 'master-data') return !code.startsWith('RUL-MD-');
        if (file.functionId === 'missing-plan') return !code.startsWith('RUL-MP-');
        if (file.functionId === 'function-rate') return !code.startsWith('RUL-FR-');
        if (file.functionId === 'opportunities') return !code.startsWith('RUL-OPP-');
        if (file.functionId === 'over-planning') {
          // Over-planning covers RUL-EFFORT/RUL-STATE/RUL-MGR but not other engines.
          return (
            code.startsWith('RUL-MD-') ||
            code.startsWith('RUL-MP-') ||
            code.startsWith('RUL-FR-') ||
            code.startsWith('RUL-OPP-')
          );
        }
        return expectedPrefix ? !code.startsWith(expectedPrefix) : false;
      });
      if (rogue) {
        return `These findings were produced by another function's ruleset (${rogue.ruleCode}). Re-run the audit to apply the ${file.functionId} rules.`;
      }
    }
    return null;
  })();
  const searchIndex = useMemo(() => {
    return (result?.issues ?? []).map((issue) => ({
      issue,
      blob: [
        issue.severity,
        issue.projectNo,
        issue.projectName,
        issue.projectManager,
        issue.email ?? '',
        issue.sheetName,
        issue.projectState,
        issue.effort,
        issue.ruleName,
        issue.auditStatus,
        issue.category,
        issue.reason,
        issue.notes,
        issue.recommendedAction,
      ].join(' ').toLowerCase(),
    }));
  }, [result]);

  // Debounce the filter pipeline so typing doesn't thrash the issue list.
  const debouncedSearch = useDebouncedValue(search, 200);
  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    const masterData = isFunctionId(file?.functionId) && file!.functionId === 'master-data';
    return searchIndex
      .filter(({ issue }) => !severity || issue.severity === severity)
      .filter(({ issue }) => !sheet || issue.sheetName === sheet)
      .filter(({ issue }) => {
        if (!status) return true;
        // Master-data uses semantic values; other engines use exact rule-code match.
        if (masterData) return matchesMasterDataRuleFilter(issueRuleKey(issue), status);
        return issueRuleKey(issue) === status;
      })
      .filter(({ issue }) => {
        if (!category) return true;
        if (masterData) {
          // MD dropdown lists column names; compare against the column derived from ruleCode.
          return masterDataColumnLabel(issue.ruleCode ?? issue.ruleId) === category;
        }
        return issue.category === category;
      })
      .filter(({ blob }) => !query || blob.includes(query))
      .map(({ issue }) => issue)
      .sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')));
  }, [searchIndex, severity, sheet, status, category, debouncedSearch, sort, file]);

  const sheets = result ? [...new Set(result.issues.map((issue) => issue.sheetName))] : [];
  const hasSelected = Boolean(file?.sheets.some((item) => item.status === 'valid' && item.isSelected));
  const functionId = isFunctionId(file?.functionId) ? file!.functionId : undefined;
  const functionLabel = functionId ? getFunctionLabel(functionId) : 'Audit';
  const isMasterData = functionId === 'master-data';
  const issueHeaders = useMemo(() => visibleIssueHeaders(functionId), [functionId]);

  // Master-data swaps category dropdown for column-name dropdown.
  const categoryFilterOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    if (!result) return [];
    if (isMasterData) {
      // List every configured column (even 0-issue ones) so it's obvious
      // which columns were checked; filtering only those with findings
      // previously made missing columns look un-audited.
      return MD_REQUIRED_COLUMNS.map((col) => ({ value: col.label, label: col.label }));
    }
    return categoryOptions.map((c) => ({ value: c, label: c }));
  }, [result, isMasterData]);

  // MD uses 3 semantic rule options; other engines list raw rule codes from issues.
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-950 dark:text-white">Audit Results</h2>
            {functionId ? <Badge tone="blue">{functionLabel}</Badge> : null}
            {policyChanged && !isMasterData ? <Badge tone="amber">Policy changed - re-run audit</Badge> : null}
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
          <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
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
                onClick={() => {
                  void runAudit(process.id, file.id, mappingSource ? { mappingSource } : undefined).catch(
                    (err: unknown) => {
                      toast.error(err instanceof Error ? err.message : 'Audit failed — please try again.');
                    },
                  );
                }}
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
          {(() => {
            const isAiCode = (c: string | undefined | null) => !!c && c.startsWith('ai_');
            const engineIssues = result.issues.filter(
              (i) => !isAiCode(i.ruleCode ?? i.ruleId),
            );
            const aiIssues = result.issues.filter((i) =>
              isAiCode(i.ruleCode ?? i.ruleId),
            );
            const distinctRowKeys = (issues: typeof result.issues) => {
              const set = new Set<string>();
              for (const i of issues) {
                if (i.rowIndex == null) continue;
                set.add(`${i.sheetName}::${i.rowIndex}`);
              }
              return set.size;
            };
            const engineFlagged = Math.min(
              distinctRowKeys(engineIssues),
              result.scannedRows,
            );
            const hasAi = aiIssues.length > 0;
            return (
              <div
                className={`grid gap-3 ${hasAi ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}
              >
                <MetricCard label="Scanned Rows" value={result.scannedRows} />
                <MetricCard label="Flagged Rows" value={engineFlagged} />
                <MetricCard label="Issues" value={engineIssues.length} />
                <MetricCard label="Sheets Audited" value={result.sheets.length} />
                {hasAi ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950">
                    <div className="flex items-center gap-1.5">
                      <AiBadge />
                      <div className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-200">
                        AI Issues
                      </div>
                    </div>
                    <div className="mt-2 text-2xl font-bold text-rose-900 dark:text-rose-100">
                      {aiIssues.length}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })()}

          {result.issues.length > 0 ? (
            <EscalationCenterCta
              processId={process.id}
              processDisplayCode={process.displayCode}
              managerCount={
                new Set(
                  result.issues
                    .map((issue) => (issue.projectManager ?? '').trim().toLowerCase())
                    .filter(Boolean),
                ).size
              }
            />
          ) : null}

          {staleReason ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              <div>
                <div className="font-semibold">Stale audit result</div>
                <div className="mt-1">{staleReason}</div>
              </div>
              {file ? (
                <button
                  type="button"
                  onClick={() => {
                    void runAudit(process.id, file.id, mappingSource ? { mappingSource } : undefined).catch(
                      (err: unknown) => {
                        toast.error(err instanceof Error ? err.message : 'Audit failed — please try again.');
                      },
                    );
                  }}
                  disabled={!hasSelected || !mappingSourceOk || !canEdit}
                  title={editTooltip}
                  className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
                >
                  Re-run audit
                </button>
              ) : null}
            </div>
          ) : null}

          {policyChanged ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <div className="font-semibold">Policy used</div>
            <div className="mt-1 text-gray-600 dark:text-gray-300">{policySummary(result.policySnapshot ?? process.auditPolicy)}</div>
            <div className="mt-2">Settings were changed after this audit. Re-run audit to apply the latest QGC policy.</div>
          </div> : null}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700"><tr><th scope="col" className="p-3">Sheet</th><th scope="col">Status</th><th scope="col">Rows</th><th scope="col">Flagged</th></tr></thead>
              <tbody>
                {file?.sheets.map((item) => {
                  const audited = result.sheets.find((sheetResult) => sheetResult.sheetName === item.name);
                  return <tr key={item.name} className="border-t border-gray-100 even:bg-gray-50/60 dark:border-gray-700 dark:even:bg-gray-900/40"><td className="p-3">{item.name}</td><td><StatusBadge value={item.status === 'valid' ? 'Valid' : item.status === 'duplicate' ? 'Duplicate' : 'Invalid'} /></td><td>{item.rowCount}</td><td>{audited?.flaggedCount ?? '-'}</td></tr>;
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap gap-2">
              <select value={sheet} onChange={(event) => setSheet(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="">Sheet</option>{sheets.map((item) => <option key={item}>{item}</option>)}</select>
              <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="">Severity</option><option>High</option><option>Medium</option><option>Low</option></select>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="">{isMasterData ? 'All columns' : 'All categories'}</option>{categoryFilterOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="">{isMasterData ? 'All rules' : 'Rule status'}</option>{ruleFilterOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
              <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search..." className="min-w-52 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-700">
              <span className="text-gray-500">{filtered.length} of {result.issues.length} issues shown</span>
              <div className="flex gap-2">
                <button onClick={() => openAuditReport(process, result)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">PDF Report</button>
                <button onClick={() => exportIssuesCsv('audit-issues.csv', filtered)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700">Export CSV</button>
              </div>
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{issueHeaders.map(({ key, label }) => <th key={key} scope="col" onClick={() => setSort(key)} className="cursor-pointer whitespace-nowrap p-3 font-semibold">{label}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((issue) => (
                  <Fragment key={issue.id}>
                    <tr
                      ref={highlightedRowId === issue.id ? attachHighlightRef : null}
                      onClick={() => setExpanded(expanded === issue.id ? '' : issue.id)}
                      className={`group cursor-pointer border-t border-gray-100 align-top even:bg-gray-50/60 hover:bg-gray-100 dark:border-gray-700 dark:even:bg-gray-900/40 dark:hover:bg-gray-700 ${flashRowId === issue.id ? 'bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-500 ring-inset' : ''}`}
                    >
                      <td className="p-3"><div className="flex items-center gap-2"><ChevronRight size={15} className={`transition ${expanded === issue.id ? 'rotate-90' : ''}`} /><Badge tone={severityTone[issue.severity]}>{issue.severity}</Badge></div></td>
                      <td className="p-3">{issue.projectNo}</td>
                      <td className="p-3">{issue.projectName}</td>
                      <td className="p-3">{issue.projectManager}</td>
                      <td className="p-3 text-xs text-gray-600 dark:text-gray-300">{issue.email?.trim() ? issue.email : '—'}</td>
                      <td className="p-3">{issue.sheetName}</td>
                      <td className="p-3">{issue.projectState}</td>
                      {!isMasterData ? <td className="p-3">{issue.effort}</td> : null}
                      <td className="max-w-lg p-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge tone={issue.category === 'Needs Review' ? 'amber' : issue.category === 'Data Quality' ? 'blue' : 'gray'}>{issue.ruleName ?? issue.auditStatus}</Badge>
                          {issue.ruleCode?.startsWith('ai_') ? <AiBadge tooltip="Authored via AI Pilot" /> : null}
                          {issue.category === 'Needs Review' ? <Badge tone="amber">Needs review</Badge> : null}
                        </div>
                        <div className="mt-1 text-gray-700 dark:text-gray-200">{issue.reason ?? issue.notes}</div>
                        <div className="mt-1 hidden text-xs text-gray-400 group-hover:block">Click for details, notes, and corrections</div>
                      </td>
                    </tr>
                    {expanded === issue.id ? (
                      <tr className="border-t border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                        <td colSpan={isMasterData ? 8 : 9} className="p-4">
                          <div className="grid gap-3 text-sm md:grid-cols-4">
                            <Detail label="Why flagged?" value={issue.reason ?? issue.notes} />
                            <Detail label="Category" value={issue.category ?? 'Audit rule'} />
                            <Detail label="Threshold" value={issue.thresholdLabel ?? '-'} />
                            <Detail label="Recommended action" value={issue.recommendedAction ?? 'Review this project with the owner.'} />
                          </div>
                          <IssueComments
                            comments={selectIssueComments(process, issue)}
                            onAdd={(body) => addIssueComment(process.id, auditIssueKey(issue), body)}
                            onDelete={(commentId) => deleteIssueComment(process.id, auditIssueKey(issue), commentId)}
                            canEdit={canEdit}
                            readOnlyReason={editTooltip}
                          />
                          <div className="mt-4">
                            <div className="mb-2 text-xs font-semibold text-gray-500">Auditor decision</div>
                            <div className="flex flex-wrap gap-2">
                              {(['needs_review', 'acknowledged', 'corrected'] as AcknowledgmentStatus[]).map((statusOption) => {
                                const current = process.acknowledgments?.[auditIssueKey(issue)]?.status ?? 'needs_review';
                                const label = statusOption === 'needs_review' ? 'Needs review' : statusOption === 'acknowledged' ? 'Acknowledged' : 'Corrected';
                                const active = current === statusOption;
                                return (
                                  <button
                                    key={statusOption}
                                    type="button"
                                    disabled={!canEdit}
                                    title={editTooltip}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setIssueAcknowledgment(process.id, auditIssueKey(issue), statusOption);
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
                            onSave={(correction) => saveIssueCorrection(process.id, auditIssueKey(issue), correction)}
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
            {!filtered.length ? <div className="p-5 text-sm text-gray-500">No issues match your filters.</div> : null}
          </div>
        </>
      )}

      {settingsOpen ? <QgcSettingsDrawer process={process} file={file} mappingSource={mappingSource} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return <div className="flex items-center gap-2"><Icon size={16} className={done ? 'text-green-600' : 'text-gray-400'} />{children}</div>;
}

function IssueCorrectionEditor({ issue, correction, onSave, onClear, canEdit = true, readOnlyReason }: { issue: AuditIssue; correction?: IssueCorrection | undefined; onSave: (correction: Omit<IssueCorrection, 'issueKey' | 'processId' | 'updatedAt'>) => void; onClear: () => void; canEdit?: boolean; readOnlyReason?: string | undefined }) {
  const [effort, setEffort] = useState(String(correction?.effort ?? issue.effort));
  const [projectState, setProjectState] = useState(correction?.projectState ?? issue.projectState);
  const [projectManager, setProjectManager] = useState(correction?.projectManager ?? issue.projectManager);
  const [note, setNote] = useState(correction?.note ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    onSave({ effort: Number(effort) || 0, projectState: projectState.trim(), projectManager: projectManager.trim(), note });
  }

  return (
    <section className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700" title={canEdit ? undefined : readOnlyReason}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">Inline correction</h4>
        {correction ? <span className="text-xs text-gray-500">Updated {new Date(correction.updatedAt).toLocaleString()}</span> : null}
      </div>
      <form onSubmit={submit} className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="text-xs text-gray-500">Effort<input value={effort} disabled={!canEdit} onChange={(event) => setEffort(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900" /></label>
        <label className="text-xs text-gray-500">State<input value={projectState} disabled={!canEdit} onChange={(event) => setProjectState(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900" /></label>
        <label className="text-xs text-gray-500">Manager<input value={projectManager} disabled={!canEdit} onChange={(event) => setProjectManager(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900" /></label>
        <label className="text-xs text-gray-500">Note<input value={note} disabled={!canEdit} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900" /></label>
        <div className="flex gap-2 md:col-span-4">
          <Button type="submit" size="sm" disabled={!canEdit} title={canEdit ? undefined : readOnlyReason}>Save correction</Button>
          {correction ? <Button variant="secondary" size="sm" onClick={onClear} disabled={!canEdit} title={canEdit ? undefined : readOnlyReason}>Clear correction</Button> : null}
        </div>
      </form>
    </section>
  );
}

function IssueComments({ comments, onAdd, onDelete, canEdit = true, readOnlyReason }: { comments: IssueComment[]; onAdd: (body: string) => void; onDelete: (commentId: string) => void; canEdit?: boolean; readOnlyReason?: string | undefined }) {
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
        <span className="text-xs text-gray-500">{comments.length} comment{comments.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-3 space-y-2">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-500">{comment.author} - {new Date(comment.createdAt).toLocaleString()}</div>
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
        {!comments.length ? <div className="text-sm text-gray-500">No notes yet. Capture PM feedback, approval context, or follow-up details here.</div> : null}
      </div>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={canEdit ? 'Add audit note...' : 'Read-only — comments disabled'}
          disabled={!canEdit}
          title={canEdit ? undefined : readOnlyReason}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
        />
        <Button type="submit" size="sm" disabled={!canEdit || !body.trim()} title={canEdit ? undefined : readOnlyReason}>Add note</Button>
      </form>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function QgcSettingsDrawer({
  process,
  file,
  mappingSource,
  onClose,
}: {
  process: AuditProcess;
  file?: WorkbookFile | undefined;
  mappingSource?: MappingSourceInput | undefined;
  onClose: () => void;
}) {
  const updateAuditPolicy = useAppStore((state) => state.updateAuditPolicy);
  const resetAuditPolicy = useAppStore((state) => state.resetAuditPolicy);
  const runAudit = useAppStore((state) => state.runAudit);
  const [draft, setDraft] = useState<AuditPolicy>(process.auditPolicy);
  const isOverPlanning = file?.functionId === 'over-planning';
  const isMissingPlan = file?.functionId === 'missing-plan';
  const isFunctionRate = file?.functionId === 'function-rate';
  const isInternalCostRate = file?.functionId === 'internal-cost-rate';
  const isOpportunities = file?.functionId === 'opportunities';

  function setNumber(key: keyof AuditPolicy, value: string) {
    setDraft((state) => ({ ...state, [key]: Number(value) || 0 }));
  }

  function setFlag(key: keyof AuditPolicy, value: boolean) {
    setDraft((state) => ({ ...state, [key]: value }));
  }

  type OpportunitiesField = NonNullable<AuditPolicy['opportunities']>;
  function setOpp<K extends keyof OpportunitiesField>(key: K, value: OpportunitiesField[K]) {
    setDraft((state) => ({
      ...state,
      opportunities: { ...(state.opportunities ?? {}), [key]: value },
    }));
  }
  function setOppNumber(key: keyof OpportunitiesField, value: string) {
    const parsed = Number(value);
    setOpp(key, (Number.isFinite(parsed) ? parsed : 0) as OpportunitiesField[typeof key]);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    updateAuditPolicy(process.id, { ...draft, mediumEffortMin: 0, mediumEffortMax: 0, lowEffortEnabled: false });
    if (file) {
      const runOptions = (isOverPlanning || isFunctionRate || isInternalCostRate) && mappingSource ? { mappingSource } : undefined;
      // Only toast "re-run" on actual success; runAudit previously silently
      // no-op'd or threw without surfacing, so the message lied.
      void runAudit(process.id, file.id, runOptions)
        .then(() => toast.success('Settings saved and audit re-run'))
        .catch((err: unknown) => {
          toast.success('Settings saved');
          toast.error(err instanceof Error ? err.message : 'Audit failed — please re-run manually.');
        });
    } else {
      toast.success('Settings saved');
    }
    onClose();
  }

  function reset() {
    setDraft(createDefaultAuditPolicy());
    resetAuditPolicy(process.id);
    toast.success('QGC settings reset. Re-run audit to apply.');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <form onSubmit={save} className="h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">QGC Settings</h3>
            <p className="mt-1 text-sm text-gray-500">Configure thresholds for this process. Re-run audit after saving.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
        </div>

        {isOverPlanning ? (
          <SettingsSection title="Overplanning threshold">
            <NumberField
              label="Flag when monthly Effort PD exceeds"
              value={draft.pdThreshold ?? 30}
              suffix="PD per month"
              onChange={(value) => setNumber('pdThreshold', value)}
            />
          </SettingsSection>
        ) : isMissingPlan ? (
          <SettingsSection title="Missing Planning rules">
            <Toggle label="Flag missing effort (absent / blank)" checked={draft.missingEffortEnabled} onChange={(checked) => setFlag('missingEffortEnabled', checked)} />
            <Toggle label="Flag zero effort" checked={draft.zeroEffortEnabled} onChange={(checked) => setFlag('zeroEffortEnabled', checked)} />
          </SettingsSection>
        ) : isFunctionRate ? (
          <SettingsSection title="Function Rate rule">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              External rate columns are auto-detected. Any month with a rate of exactly 0 is flagged;
              blank cells are ignored. No configurable thresholds.
            </p>
          </SettingsSection>
        ) : isInternalCostRate ? (
          <SettingsSection title="Internal Cost Rate rule">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Monthly cost-rate columns are auto-detected. Any month with a rate of exactly 0 is flagged;
              blank cells are ignored. No configurable thresholds.
            </p>
          </SettingsSection>
        ) : isOpportunities ? (
          <SettingsSection title="Opportunities checks">
            <NumberField
              label="Closed-in-past low-probability max (rule fires when probability is strictly less than)"
              value={draft.opportunities?.closeDateLowProbabilityMax ?? 75}
              suffix="%"
              onChange={(value) => setOppNumber('closeDateLowProbabilityMax', value)}
            />
            <NumberField
              label="Project-start-in-past low-probability max"
              value={draft.opportunities?.projectStartLowProbabilityMax ?? 90}
              suffix="%"
              onChange={(value) => setOppNumber('projectStartLowProbabilityMax', value)}
            />
            <NumberField
              label="Missing BCS exact probability (Service category)"
              value={draft.opportunities?.missingBcsProbabilityExact ?? 90}
              suffix="%"
              onChange={(value) => setOppNumber('missingBcsProbabilityExact', value)}
            />
            <NumberField
              label="BCS available low-probability max (Service category)"
              value={draft.opportunities?.bcsAvailableLowProbabilityMax ?? 90}
              suffix="%"
              onChange={(value) => setOppNumber('bcsAvailableLowProbabilityMax', value)}
            />
            <label className="block text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-200">Brazil expected Business Unit</span>
              <input
                type="text"
                value={draft.opportunities?.brazilExpectedBu ?? 'Brazil'}
                onChange={(event) => setOpp('brazilExpectedBu', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </SettingsSection>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No configurable thresholds for this function.</p>
        )}

        <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-gray-200 bg-white pt-4 dark:border-gray-700 dark:bg-gray-900">
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">{file ? 'Save & Re-run Audit' : 'Save Settings'}</button>
          <button type="button" onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Reset Defaults</button>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <h4 className="font-semibold">{title}</h4>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix?: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        {suffix ? <span className="text-xs text-gray-500">{suffix}</span> : null}
      </div>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}</label>;
}

// One-click bridge to the Escalation Center, the single place to compose/track.
function EscalationCenterCta({
  processId,
  processDisplayCode,
  managerCount,
}: {
  processId: string;
  processDisplayCode: string | undefined;
  managerCount: number;
}) {
  const href = escalationCenterPath(processDisplayCode ?? processId);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm">
      <div>
        <div className="font-semibold text-gray-900 dark:text-white">
          {managerCount} manager{managerCount === 1 ? '' : 's'} to notify
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          The Escalation Center is where you compose one message per manager, broadcast to everyone, track SLA, and walk the escalation ladder.
        </div>
      </div>
      <a
        href={href}
        className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
      >
        Open Escalation Center →
      </a>
    </div>
  );
}