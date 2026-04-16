import { createDefaultAuditPolicy, normalizeAuditPolicy } from './auditPolicy';
import type { AuditIssue, AuditPolicy, AuditResult, ComparisonResult, IssueCategory, Severity, WorkbookFile } from './types';

type RowObject = Record<string, unknown>;
type AuditRule = {
  id: string;
  name: string;
  category: IssueCategory;
  severity: Severity;
  check: (row: RowObject) => boolean;
  reason: (row: RowObject) => string;
  thresholdLabel: string;
  recommendedAction: string;
};

const value = (row: RowObject, names: string[]) => names.map((name) => row[name]).find((item) => item !== undefined && item !== null && String(item).trim() !== '');
const text = (row: RowObject, names: string[]) => String(value(row, names) ?? '').trim();
const num = (row: RowObject, names: string[]) => Number(value(row, names) ?? 0) || 0;
const hasValue = (row: RowObject, names: string[]) => value(row, names) !== undefined;
const isBlankRow = (row: unknown[]) => row.every((cell) => String(cell ?? '').trim() === '');

const PROJECT_NO_FIELDS = ['projectNo', 'Project No', 'Project No.', 'Project Number', 'Project ID'];
const PROJECT_NAME_FIELDS = ['projectName', 'Project Name', 'Project', 'Name'];
const MANAGER_FIELDS = ['projectManager', 'Project Manager', 'Manager'];
const STATE_FIELDS = ['projectState', 'Project State', 'State'];
const EFFORT_FIELDS = ['effort', 'Effort', 'Hours', 'Effort (H)', 'Effort H', 'Planned Effort'];
const EMAIL_FIELDS = ['email', 'Email', 'Manager Email', 'Project Manager Email'];

export function buildAuditRules(policy: AuditPolicy): AuditRule[] {
  const rules: AuditRule[] = [
    {
      id: 'HIGH_EFFORT',
      name: 'Overplanned effort',
      category: 'Overplanning',
      severity: 'High',
      check: (row) => hasValue(row, EFFORT_FIELDS) && num(row, EFFORT_FIELDS) > policy.highEffortThreshold,
      reason: (row) => `Effort is ${num(row, EFFORT_FIELDS)}h, above the configured overplanning threshold of ${policy.highEffortThreshold}h.`,
      thresholdLabel: `>${policy.highEffortThreshold}h`,
      recommendedAction: 'Review capacity, confirm planning assumptions, and escalate if the effort cannot be reduced or justified.',
    },
  ];

  if (policy.lowEffortEnabled) {
    rules.push({
      id: 'LOW_EFFORT',
      name: 'Low effort range',
      category: 'Effort Threshold',
      severity: 'Low',
      check: (row) => {
        const effort = num(row, EFFORT_FIELDS);
        return hasValue(row, EFFORT_FIELDS) && effort >= policy.lowEffortMin && effort <= policy.lowEffortMax;
      },
      reason: (row) => `Effort is ${num(row, EFFORT_FIELDS)}h, inside the low tracking range.`,
      thresholdLabel: `${policy.lowEffortMin}-${policy.lowEffortMax}h`,
      recommendedAction: 'Track as low risk and confirm effort is not underplanned.',
    });
  }

  if (policy.missingEffortEnabled) {
    rules.push({
      id: 'MISSING_EFFORT',
      name: 'Missing effort',
      category: 'Missing Planning',
      severity: 'High',
      check: (row) => !hasValue(row, EFFORT_FIELDS),
      reason: () => 'Effort value is missing.',
      thresholdLabel: 'Blank effort',
      recommendedAction: 'Ask the project manager to provide the planned effort before the next review.',
    });
  }

  if (policy.zeroEffortEnabled) {
    rules.push({
      id: 'ZERO_EFFORT',
      name: 'Zero effort',
      category: 'Missing Planning',
      severity: 'Medium',
      check: (row) => hasValue(row, EFFORT_FIELDS) && num(row, EFFORT_FIELDS) === 0,
      reason: () => 'Effort is 0; confirm whether effort planning is pending or intentionally zero.',
      thresholdLabel: '0h',
      recommendedAction: 'Confirm whether the project is not yet planned, cancelled, or intentionally set to zero.',
    });
  }

  if (policy.missingManagerEnabled) {
    rules.push({
      id: 'MISSING_MANAGER',
      name: 'Missing project manager',
      category: 'Other',
      severity: 'High',
      check: (row) => !text(row, MANAGER_FIELDS),
      reason: () => 'No project manager is assigned.',
      thresholdLabel: 'Manager required',
      recommendedAction: 'Assign a project manager so notifications and ownership are clear.',
    });
  }

  if (policy.onHoldEffortEnabled) {
    rules.push({
      id: 'ON_HOLD_HIGH_EFFORT',
      name: 'On Hold with effort',
      category: 'Other',
      severity: 'High',
      check: (row) => text(row, STATE_FIELDS).toLowerCase() === 'on hold' && num(row, EFFORT_FIELDS) > policy.onHoldEffortThreshold,
      reason: (row) => `Project is On Hold but has ${num(row, EFFORT_FIELDS)}h effort logged.`,
      thresholdLabel: `On Hold >${policy.onHoldEffortThreshold}h`,
      recommendedAction: 'Confirm whether work should continue while the project is On Hold.',
    });
  }

  if (policy.inPlanningEffortEnabled) {
    rules.push({
      id: 'IN_PLANNING_EFFORT',
      name: 'In Planning with effort',
      category: 'Other',
      severity: 'Medium',
      check: (row) => text(row, STATE_FIELDS).toLowerCase() === 'in planning' && num(row, EFFORT_FIELDS) > 0,
      reason: (row) => `Project is In Planning with ${num(row, EFFORT_FIELDS)}h already logged.`,
      thresholdLabel: 'In Planning >0h',
      recommendedAction: 'Confirm whether execution has started or the project state needs updating.',
    });
  }

  return rules;
}

const severityRank: Record<Severity, number> = { High: 3, Medium: 2, Low: 1 };

function rowsToObjects(rows: unknown[][], headerRowIndex: number, normalizedHeaders?: string[]): Array<{ row: RowObject; rowIndex: number }> {
  const originalHeaders = (rows[headerRowIndex] ?? []).map((cell) => String(cell ?? '').trim());
  const headers = normalizedHeaders?.length ? normalizedHeaders : originalHeaders;
  return rows
    .slice(headerRowIndex + 1)
    .map((row, index) => ({ cells: row, rowIndex: headerRowIndex + 1 + index }))
    .filter(({ cells }) => !isBlankRow(cells))
    .map(({ cells, rowIndex }) => {
      const row: RowObject = {};
      headers.forEach((header, index) => {
        const originalHeader = originalHeaders[index];
        const cell = cells[index];
        const canonicalKey = String(header ?? '').trim();
        const originalKey = String(originalHeader ?? '').trim();
        if (canonicalKey && !canonicalKey.startsWith('column') && row[canonicalKey] === undefined) row[canonicalKey] = cell;
        if (originalKey) {
          let key = originalKey;
          let suffix = 2;
          while (row[key] !== undefined) {
            key = `${originalKey} ${suffix}`;
            suffix += 1;
          }
          row[key] = cell;
        }
      });
      return { row, rowIndex };
    });
}

export function runAudit(file: WorkbookFile, auditPolicy?: AuditPolicy): AuditResult {
  const policy = normalizeAuditPolicy(auditPolicy);
  const rules = buildAuditRules(policy);
  const issues: AuditIssue[] = [];
  const sheetResults = file.sheets
    .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
    .map((sheet) => {
      const rows = rowsToObjects(file.rawData[sheet.name] ?? [], sheet.headerRowIndex ?? 0, sheet.normalizedHeaders);
      let flaggedCount = 0;
      rows.forEach(({ row, rowIndex }) => {
        const matches = rules.filter((rule) => rule.check(row)).sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
        if (!matches.length) return;
        flaggedCount += 1;
        const primary = matches[0]!;
        const notes = matches.map((rule) => rule.reason(row)).join('; ');
        const manager = text(row, MANAGER_FIELDS) || 'Unassigned';
        issues.push({
          id: `${file.id}-${sheet.name}-${rowIndex}-${primary.id}`,
          projectNo: text(row, PROJECT_NO_FIELDS) || `Row ${rowIndex + 1}`,
          projectName: text(row, PROJECT_NAME_FIELDS) || 'Unnamed project',
          sheetName: sheet.name,
          severity: primary.severity,
          projectManager: manager,
          projectState: text(row, STATE_FIELDS) || 'Unknown',
          effort: num(row, EFFORT_FIELDS),
          auditStatus: matches.length > 1 ? 'Multiple issues' : primary.id.replaceAll('_', ' '),
          notes,
          rowIndex,
          email: text(row, EMAIL_FIELDS),
          ruleId: primary.id,
          ruleName: primary.name,
          category: primary.category,
          reason: primary.reason(row),
          thresholdLabel: primary.thresholdLabel,
          recommendedAction: primary.recommendedAction,
        });
      });
      return { sheetName: sheet.name, rowCount: rows.length, flaggedCount };
    });

  return {
    fileId: file.id,
    runAt: new Date().toISOString(),
    scannedRows: sheetResults.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    flaggedRows: sheetResults.reduce((sum, sheet) => sum + sheet.flaggedCount, 0),
    issues,
    sheets: sheetResults,
    policySnapshot: policy,
  };
}

export const auditIssueKey = (issue: Pick<AuditIssue, 'projectNo' | 'sheetName' | 'rowIndex'>) => `${issue.projectNo}|${issue.sheetName}|${issue.rowIndex}`;

const keyFor = auditIssueKey;

export function compareResults(from: AuditResult, to: AuditResult): ComparisonResult {
  const fromMap = new Map(from.issues.map((issue) => [keyFor(issue), issue]));
  const toMap = new Map(to.issues.map((issue) => [keyFor(issue), issue]));
  const newIssues = to.issues.filter((issue) => !fromMap.has(keyFor(issue)));
  const resolvedIssues = from.issues.filter((issue) => !toMap.has(keyFor(issue)));
  const shared = to.issues.filter((issue) => fromMap.has(keyFor(issue)));
  const changedIssues = shared.filter((issue) => {
    const prev = fromMap.get(keyFor(issue))!;
    return prev.severity !== issue.severity || prev.projectManager !== issue.projectManager || prev.effort !== issue.effort || prev.projectState !== issue.projectState || prev.auditStatus !== issue.auditStatus;
  });
  return {
    newIssues,
    resolvedIssues,
    changedIssues,
    unchangedIssues: shared.filter((issue) => !changedIssues.includes(issue)),
    managerChanges: shared.filter((issue) => fromMap.get(keyFor(issue))!.projectManager !== issue.projectManager),
    effortChanges: shared.filter((issue) => fromMap.get(keyFor(issue))!.effort !== issue.effort),
    stateChanges: shared.filter((issue) => fromMap.get(keyFor(issue))!.projectState !== issue.projectState),
  };
}

export function exportIssuesCsv(fileName: string, issues: AuditIssue[]): void {
  const header = ['Severity', 'Project No', 'Project Name', 'Manager', 'Sheet', 'State', 'Effort', 'Rule', 'Category', 'Reason', 'Recommended Action'];
  const escape = (cell: unknown) => `"${String(cell ?? '').replaceAll('"', '""')}"`;
  const csv = [header, ...issues.map((issue) => [issue.severity, issue.projectNo, issue.projectName, issue.projectManager, issue.sheetName, issue.projectState, issue.effort, issue.ruleName ?? issue.auditStatus, issue.category ?? '', issue.reason ?? issue.notes, issue.recommendedAction ?? ''])]
    .map((row) => row.map(escape).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
