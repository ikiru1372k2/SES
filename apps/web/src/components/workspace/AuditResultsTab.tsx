import { CheckCircle2, ChevronDown, Circle, Send, Settings, X } from 'lucide-react';
import { AiBadge } from '../ai-pilot/AiBadge';
import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { MappingSourceInput } from '../../lib/api/auditsApi';
import { MappingSourcePanel } from './MappingSourcePanel';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getFunctionLabel,
  getFunctionPolicySummary,
  isFunctionId,
  MD_COLUMNS,
  MD_PROJECT_PRODUCT_NOT_ASSIGNED_RULE_CODE,
  MD_REQUIRED_COLUMNS,
  MD_REVIEW_OTHERS_RULE_CODE,
} from '@ses/domain';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { escalationCenterPath } from '../../lib/processRoutes';
import { createDefaultAuditPolicy, isPolicyChanged, policySummary } from '../../lib/domain/auditPolicy';
import { exportIssuesCsv } from '../../lib/domain/auditEngine';
import { getSelectedSheetNames, isAiCode } from '../../lib/workbook/auditResultFilter';
import { openAuditReport } from '../../lib/reportExporter';
import { severityTone } from '../../lib/domain/severity';
import type {
  AuditPolicy,
  AuditProcess,
  AuditIssue,
  IssueCategory,
  WorkbookFile,
} from '../../lib/domain/types';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../shared/Badge';
import { EmptyState } from '../shared/EmptyState';

// Issues are grouped by Project ID (projectNo) — the stable primary key.
// Project name can change between runs; projectNo cannot. Only project-level
// sorts are meaningful on grouped rows.
type SortKey = 'projectNo' | 'projectName' | 'severity';

const categoryOptions: IssueCategory[] = [
  'Overplanning',
  'Missing Planning',
  'Data Quality',
  'Needs Review',
  'Other',
];

// Sortable + non-sortable headers for the grouped table. A leading empty
// header carries the expand chevron; trailing empty header carries the action.
const PROJECT_HEADERS: Array<{ key: SortKey | null; label: string }> = [
  { key: 'projectNo', label: 'Project ID' },
  { key: 'projectName', label: 'Project Name' },
  { key: null, label: 'Project Manager' },
  { key: null, label: 'Issue' },
  { key: 'severity', label: 'Severity' },
  { key: null, label: 'Sheet' },
  { key: null, label: '' },
];

const SEVERITY_RANK: Record<AuditIssue['severity'], number> = { High: 0, Medium: 1, Low: 2 };

interface ProjectGroup {
  projectNo: string;
  projectName: string;
  managers: { name: string; email: string }[];
  issues: AuditIssue[];
  topSeverity: AuditIssue['severity'];
  sheets: string[];
  topReason: string;
  /** True when any issue in the group was authored by an AI rule (ai_…). */
  hasAiIssue: boolean;
}

/** A finding is AI-authored when its rule code/id carries the `ai_` prefix.
 *  Uses the same predicate as the "AI Issues" metric so they cannot diverge. */
function isAiIssue(issue: AuditIssue): boolean {
  return isAiCode(issue.ruleCode ?? issue.ruleId);
}

/**
 * Group filtered issues by projectNo (primary key). projectName is display-
 * only (first non-empty seen) since it can vary across a project's issues.
 * Managers are unioned (distinct name+email) so escalation can CC everyone.
 */
function groupByProject(filtered: AuditIssue[], sort: SortKey): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  const mgrSeen = new Map<string, Set<string>>();
  const sheetSeen = new Map<string, Set<string>>();
  const reasonCount = new Map<string, Map<string, number>>();

  for (const issue of filtered) {
    const key = issue.projectNo || '(no project id)';
    let group = map.get(key);
    if (!group) {
      group = {
        projectNo: key,
        projectName: issue.projectName || '',
        managers: [],
        issues: [],
        topSeverity: issue.severity,
        sheets: [],
        topReason: '',
        hasAiIssue: false,
      };
      map.set(key, group);
      mgrSeen.set(key, new Set());
      sheetSeen.set(key, new Set());
      reasonCount.set(key, new Map());
    }
    if (!group.projectName && issue.projectName) group.projectName = issue.projectName;
    group.issues.push(issue);
    if (isAiIssue(issue)) group.hasAiIssue = true;
    if ((SEVERITY_RANK[issue.severity] ?? 9) < (SEVERITY_RANK[group.topSeverity] ?? 9)) {
      group.topSeverity = issue.severity;
    }
    const mgrKey = `${issue.projectManager ?? ''} ${issue.email ?? ''}`;
    const mgrSet = mgrSeen.get(key)!;
    if ((issue.projectManager || issue.email) && !mgrSet.has(mgrKey)) {
      mgrSet.add(mgrKey);
      group.managers.push({ name: issue.projectManager ?? '', email: issue.email ?? '' });
    }
    const sheetSet = sheetSeen.get(key)!;
    if (issue.sheetName && !sheetSet.has(issue.sheetName)) {
      sheetSet.add(issue.sheetName);
      group.sheets.push(issue.sheetName);
    }
    const reason = (issue.reason ?? issue.ruleName ?? issue.auditStatus ?? '').trim();
    if (reason) {
      const rc = reasonCount.get(key)!;
      rc.set(reason, (rc.get(reason) ?? 0) + 1);
    }
  }

  for (const [key, group] of map) {
    let best = '';
    let bestN = -1;
    for (const [reason, n] of reasonCount.get(key)!) {
      if (n > bestN) {
        bestN = n;
        best = reason;
      }
    }
    group.topReason = best;
  }

  return [...map.values()].sort((a, b) => {
    if (sort === 'severity') return (SEVERITY_RANK[a.topSeverity] ?? 9) - (SEVERITY_RANK[b.topSeverity] ?? 9);
    if (sort === 'projectName') return a.projectName.localeCompare(b.projectName);
    return a.projectNo.localeCompare(b.projectNo);
  });
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
  const [severity, setSeverity] = useState('');
  const [sheet, setSheet] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('projectNo');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const toggleProject = (projectNo: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectNo)) next.delete(projectNo);
      else next.add(projectNo);
      return next;
    });
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
    // Force-expand the parent project group so the targeted issue's row
    // mounts and attachHighlightRef can scroll/flash it.
    setExpandedProjects((prev) => new Set(prev).add(target.projectNo || '(no project id)'));
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

  const selectedSheetNames = useMemo(() => (file ? getSelectedSheetNames(file) : new Set<string>()), [file]);

  // Debounce the filter pipeline so typing doesn't thrash the issue list.
  const debouncedSearch = useDebouncedValue(search, 200);
  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    const masterData = isFunctionId(file?.functionId) && file!.functionId === 'master-data';
    return searchIndex
      .filter(({ issue }) => !severity || issue.severity === severity)
      .filter(({ issue }) => {
        if (sheet) return issue.sheetName === sheet;
        // Match master: with no explicit sheet filter and no sheet
        // selection, show ALL issues rather than hiding everything.
        // Only scope to selected sheets when the user actually selected some.
        if (selectedSheetNames.size === 0) return true;
        return selectedSheetNames.has(issue.sheetName);
      })
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
  }, [searchIndex, severity, sheet, status, category, debouncedSearch, sort, file, selectedSheetNames]);

  const sheets = result ? [...new Set(result.issues.map((issue) => issue.sheetName))] : [];
  const hasSelected = Boolean(file?.sheets.some((item) => item.status === 'valid' && item.isSelected));
  const functionId = isFunctionId(file?.functionId) ? file!.functionId : undefined;
  const functionLabel = functionId ? getFunctionLabel(functionId) : 'Audit';
  const isMasterData = functionId === 'master-data';
  const projectGroups = useMemo(() => groupByProject(filtered, sort), [filtered, sort]);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-white">Audit Results</h2>
          {functionId ? <Badge tone="blue">{functionLabel}</Badge> : null}
          {policyChanged && !isMasterData ? <Badge tone="amber">Policy changed - re-run audit</Badge> : null}
          <span className="text-sm text-gray-500">
            {result
              ? `· ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} across ${result.sheets.length} sheet${result.sheets.length === 1 ? '' : 's'}`
              : isMasterData
                ? '· flags blank, null, "not assigned" or placeholder required fields'
                : `· ${(functionId && getFunctionPolicySummary(functionId)) ?? policySummary(process.auditPolicy)}`}
          </span>
        </div>
        {!isMasterData ? (
          <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium shadow-soft transition-all ease-soft hover:border-brand hover:text-brand hover:shadow-soft-md active:scale-[0.98] dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800">
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
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-soft transition-all ease-soft hover:bg-brand-hover hover:shadow-soft-md active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
              >
                Run Audit
              </button>
            </>
          ) : null}
        </EmptyState>
      ) : (
        <>
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
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-soft dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
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
                  className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white shadow-soft transition-all ease-soft hover:bg-amber-700 hover:shadow-soft-md active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
                >
                  Re-run audit
                </button>
              ) : null}
            </div>
          ) : null}

          {policyChanged ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-soft dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <div className="font-semibold">Policy used</div>
            <div className="mt-1 text-gray-600 dark:text-gray-300">{policySummary(result.policySnapshot ?? process.auditPolicy)}</div>
            <div className="mt-2">Settings were changed after this audit. Re-run audit to apply the latest QGC policy.</div>
          </div> : null}

          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-soft dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap gap-2">
              <select value={sheet} onChange={(event) => setSheet(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-soft outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900"><option value="">Sheet</option>{sheets.map((item) => <option key={item}>{item}</option>)}</select>
              <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-soft outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900"><option value="">Severity</option><option>High</option><option>Medium</option><option>Low</option></select>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-soft outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900"><option value="">{isMasterData ? 'All columns' : 'All categories'}</option>{categoryFilterOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-soft outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900"><option value="">{isMasterData ? 'All rules' : 'Rule status'}</option>{ruleFilterOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
              <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter findings…" className="min-w-52 flex-1 rounded-lg border border-rule bg-white px-3 py-2 text-sm shadow-soft outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
              <span className="text-ink-3 tabular-nums">{filtered.length} results</span>
              <button type="button" onClick={() => { setSearch(''); setSheet(''); setSeverity(''); setCategory(''); setStatus(''); }} className="text-xs font-medium text-brand hover:underline">Clear</button>
              <span className="sr-only"> of {result.issues.length} total</span>
              <div className="flex gap-2">
                <button onClick={() => openAuditReport(process, result)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-soft transition-all ease-soft hover:border-brand hover:text-brand hover:shadow-soft-md active:scale-[0.98] dark:border-gray-700 dark:bg-gray-900">PDF Report</button>
                <button onClick={() => exportIssuesCsv('audit-issues.csv', filtered)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-soft transition-all ease-soft hover:border-brand hover:text-brand hover:shadow-soft-md active:scale-[0.98] dark:border-gray-700 dark:bg-gray-900">Export CSV</button>
              </div>
            </div>
          </div>

          <div className="max-h-[max(420px,calc(100vh-320px))] min-h-[16rem] overflow-auto rounded-xl border border-gray-200 bg-white shadow-soft dark:border-gray-800 dark:bg-gray-900">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-rule bg-surface-app dark:border-gray-800 dark:bg-gray-950">
                <tr>
                  <th scope="col" className="w-8 px-2 py-2.5" aria-hidden />
                  {PROJECT_HEADERS.map(({ key, label }, i) =>
                    key ? (
                      <th
                        key={i}
                        scope="col"
                        onClick={() => setSort(key)}
                        className="cursor-pointer select-none whitespace-nowrap px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 transition-colors hover:text-ink"
                      >
                        {label}
                        {sort === key ? <span className="ml-1 text-brand">▾</span> : null}
                      </th>
                    ) : (
                      <th key={i} scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {projectGroups.map((group) => {
                  const open = expandedProjects.has(group.projectNo);
                  const mgrNames = group.managers.map((m) => m.name).filter(Boolean);
                  const mgrLabel =
                    mgrNames.length === 0
                      ? '—'
                      : mgrNames.length <= 3
                        ? mgrNames.join(', ')
                        : `${mgrNames.slice(0, 3).join(', ')} +${mgrNames.length - 3} more`;
                  return (
                    <Fragment key={group.projectNo}>
                      <tr
                        onClick={() => toggleProject(group.projectNo)}
                        className="cursor-pointer border-t border-gray-100 align-top transition-colors even:bg-gray-50/60 hover:bg-gray-50 dark:border-gray-800 dark:even:bg-gray-900/40 dark:hover:bg-gray-900/60"
                      >
                        <td className="px-2 py-3">
                          <ChevronDown
                            size={15}
                            className={`shrink-0 text-ink-3 transition-transform duration-150 ease-soft ${open ? '' : '-rotate-90'}`}
                            aria-hidden
                          />
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 font-semibold text-ink dark:text-white">{group.projectNo}</td>
                        <td className="px-3.5 py-3">{group.projectName || '—'}</td>
                        <td className="px-3.5 py-3" title={mgrNames.join(', ')}>{mgrLabel}</td>
                        <td className="px-3.5 py-3">
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span>
                              <span className="font-medium text-ink dark:text-gray-200">{group.issues.length}</span> issue{group.issues.length === 1 ? '' : 's'}
                              {group.topReason ? <span className="ml-1 text-ink-3"> · {group.topReason}</span> : null}
                            </span>
                            {group.hasAiIssue ? <AiBadge tooltip="Includes AI-detected findings" /> : null}
                          </span>
                        </td>
                        <td className="px-3.5 py-3"><Badge tone={severityTone[group.topSeverity]}>{group.topSeverity}</Badge></td>
                        <td className="px-3.5 py-3 text-ink-3" title={group.sheets.join(', ')}>
                          {group.sheets.slice(0, 2).join(', ')}{group.sheets.length > 2 ? ` +${group.sheets.length - 2}` : ''}
                        </td>
                        <td className="px-3.5 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void navigate(escalationCenterPath(process.displayCode ?? process.id, { project: group.projectNo }));
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition-all ease-soft hover:bg-brand-hover hover:shadow-soft-md active:scale-[0.98]"
                          >
                            <Send size={12} aria-hidden /> Escalate
                          </button>
                        </td>
                      </tr>
                      {open
                        ? group.issues.map((issue) => (
                            <tr
                              key={issue.id}
                              ref={highlightedRowId === issue.id ? attachHighlightRef : null}
                              className={`border-t border-gray-100/70 bg-gray-50/40 align-top text-xs transition-colors dark:border-gray-800/70 dark:bg-gray-900/30 ${flashRowId === issue.id ? 'bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-500 ring-inset' : ''}`}
                            >
                              <td className="px-2 py-2.5" aria-hidden />
                              <td className="px-3.5 py-2.5 text-ink-3" colSpan={2}>
                                <Badge tone={severityTone[issue.severity]}>{issue.severity}</Badge>
                                <span className="ml-2 text-ink-3">{issue.sheetName}</span>
                              </td>
                              <td className="px-3.5 py-2.5 text-ink-3">
                                {issue.projectManager || '—'}
                                {issue.email?.trim() ? <span className="ml-1 text-ink-3">· {issue.email}</span> : null}
                              </td>
                              <td className="px-3.5 py-2.5" colSpan={2}>
                                <div className="flex flex-wrap items-center gap-1">
                                  <Badge tone={issue.category === 'Needs Review' ? 'amber' : issue.category === 'Data Quality' ? 'blue' : 'gray'}>{issue.ruleName ?? issue.auditStatus}</Badge>
                                  {isAiIssue(issue) ? <AiBadge tooltip="Authored via AI Pilot" /> : null}
                                </div>
                                <div className="mt-1 text-ink-2 dark:text-gray-300">{issue.reason ?? issue.notes}</div>
                              </td>
                              <td className="px-3.5 py-2.5" colSpan={2} aria-hidden />
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!filtered.length ? <div className="p-8 text-center text-sm text-gray-500">No issues match your filters.</div> : null}
          </div>
        </>
      )}

      {settingsOpen ? (
        <QgcSettingsDrawer
          process={process}
          file={file}
          mappingSource={mappingSource}
          onMappingSourceChange={onMappingSourceChange}
          overPlanningFiles={overPlanningFiles}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return <div className="flex items-center gap-2"><Icon size={16} className={done ? 'text-green-600' : 'text-gray-400'} />{children}</div>;
}

function QgcSettingsDrawer({
  process,
  file,
  mappingSource,
  onMappingSourceChange,
  overPlanningFiles,
  onClose,
}: {
  process: AuditProcess;
  file?: WorkbookFile | undefined;
  mappingSource?: MappingSourceInput | undefined;
  onMappingSourceChange?: ((src: MappingSourceInput | undefined) => void) | undefined;
  overPlanningFiles: WorkbookFile[];
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm">
      <form onSubmit={save} className="h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-soft-lg dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">QGC Settings</h3>
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
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </SettingsSection>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No configurable thresholds for this function.</p>
        )}

        {/* Manager mapping — for functions whose sheets have no manager
            column (Function Rate / Internal Cost Rate / Over-Planning),
            resolve managers by reference to Master Data. Surfaced here so
            it is reachable AFTER a first audit (the empty-state picker is
            not), and "Save & Re-run Audit" below carries it through. */}
        {file && process.displayCode && MAPPING_ENABLED_FUNCTIONS.has(file.functionId ?? '') ? (
          <SettingsSection title="Manager mapping (from Master Data)">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              This function has no manager column. Pick a Master Data source
              to resolve manager &amp; email by Project ID, then Save &amp;
              Re-run.
            </p>
            <MappingSourcePanel
              processId={process.id}
              processDisplayCode={process.displayCode}
              auditFileId={file.id}
              overPlanningFiles={overPlanningFiles}
              value={mappingSource}
              onChange={onMappingSourceChange ?? (() => {})}
            />
          </SettingsSection>
        ) : null}

        <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-gray-200 bg-white pt-4 dark:border-gray-800 dark:bg-gray-900">
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-soft transition-all ease-soft hover:bg-brand-hover hover:shadow-soft-md active:scale-[0.98]">{file ? 'Save & Re-run Audit' : 'Save Settings'}</button>
          <button type="button" onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-soft transition-all ease-soft hover:bg-gray-50 hover:shadow-soft-md active:scale-[0.98] dark:border-gray-700 dark:hover:bg-gray-800">Reset Defaults</button>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-soft transition-all ease-soft hover:bg-gray-50 hover:shadow-soft-md active:scale-[0.98] dark:border-gray-700 dark:hover:bg-gray-800">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-xl border border-gray-200 bg-gray-50/40 p-4 dark:border-gray-800 dark:bg-gray-900/40">
      <h4 className="font-semibold tracking-tight">{title}</h4>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix?: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-800" />
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm shadow-soft">
      <div>
        <div className="font-semibold tracking-tight text-gray-900 dark:text-white">
          {managerCount} manager{managerCount === 1 ? '' : 's'} to notify
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          The Escalation Center is where you compose one message per manager, broadcast to everyone, track SLA, and walk the escalation ladder.
        </div>
      </div>
      <a
        href={href}
        className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-soft transition-all ease-soft hover:bg-brand-hover hover:shadow-soft-md active:scale-[0.98]"
      >
        Open Escalation Center →
      </a>
    </div>
  );
}