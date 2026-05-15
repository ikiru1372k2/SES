import { normalizeAuditPolicy } from './auditPolicy';
import { AUDIT_RULES_BY_CODE, type RuleCatalogEntry } from './auditRules';
import type { AuditIssue, AuditPolicy, AuditResult, ChangedIssue, ComparisonResult, DiffableIssueField, IssueCategory, IssueDiffMap, Severity, WorkbookFile } from '../core/types';

type RowObject = Record<string, unknown>;
type AuditRule = RuleCatalogEntry & {
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
      ...AUDIT_RULES_BY_CODE.get('RUL-EFFORT-OVERPLAN-HIGH')!,
      check: (row) => hasValue(row, EFFORT_FIELDS) && num(row, EFFORT_FIELDS) > policy.highEffortThreshold,
      reason: (row) => `Effort is ${num(row, EFFORT_FIELDS)}h, above the configured overplanning threshold of ${policy.highEffortThreshold}h.`,
      thresholdLabel: `>${policy.highEffortThreshold}h`,
      recommendedAction: 'Review capacity, confirm planning assumptions, and escalate if the effort cannot be reduced or justified.',
    },
  ];

  if (policy.lowEffortEnabled) {
    rules.push({
      ...AUDIT_RULES_BY_CODE.get('RUL-EFFORT-OVERPLAN-LOW')!,
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
      ...AUDIT_RULES_BY_CODE.get('RUL-EFFORT-MISSING')!,
      check: (row) => !hasValue(row, EFFORT_FIELDS),
      reason: () => 'Effort value is missing.',
      thresholdLabel: 'Blank effort',
      recommendedAction: 'Ask the project manager to provide the planned effort before the next review.',
    });
  }

  if (policy.zeroEffortEnabled) {
    rules.push({
      ...AUDIT_RULES_BY_CODE.get('RUL-EFFORT-ZERO')!,
      check: (row) => hasValue(row, EFFORT_FIELDS) && num(row, EFFORT_FIELDS) === 0,
      reason: () => 'Effort is 0; confirm whether effort planning is pending or intentionally zero.',
      thresholdLabel: '0h',
      recommendedAction: 'Confirm whether the project is not yet planned, cancelled, or intentionally set to zero.',
    });
  }

  if (policy.missingManagerEnabled) {
    rules.push({
      ...AUDIT_RULES_BY_CODE.get('RUL-MGR-MISSING')!,
      check: (row) => !text(row, MANAGER_FIELDS),
      reason: () => 'No project manager is assigned.',
      thresholdLabel: 'Manager required',
      recommendedAction: 'Assign a project manager so notifications and ownership are clear.',
    });
  }

  if (policy.onHoldEffortEnabled) {
    rules.push({
      ...AUDIT_RULES_BY_CODE.get('RUL-STATE-ONHOLD-EFFORT')!,
      check: (row) => text(row, STATE_FIELDS).toLowerCase() === 'on hold' && num(row, EFFORT_FIELDS) > policy.onHoldEffortThreshold,
      reason: (row) => `Project is On Hold but has ${num(row, EFFORT_FIELDS)}h effort logged.`,
      thresholdLabel: `On Hold >${policy.onHoldEffortThreshold}h`,
      recommendedAction: 'Confirm whether work should continue while the project is On Hold.',
    });
  }

  if (policy.inPlanningEffortEnabled) {
    rules.push({
      ...AUDIT_RULES_BY_CODE.get('RUL-STATE-INPLAN-EFFORT')!,
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

export interface RunAuditOptions {
  issueScope?: string;
  runCode?: string;
}

export function normalizeProjectNo(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function sha1Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotateLeft(words[i - 3]! ^ words[i - 8]! ^ words[i - 14]! ^ words[i - 16]!, 1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotateLeft(a, 5) + f + e + k + words[i]!) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((part) => part.toString(16).padStart(8, '0')).join('');
}

export function createIssueKey(
  scopeKey: string,
  issue: Pick<AuditIssue, 'projectNo' | 'sheetName' | 'rowIndex' | 'ruleCode' | 'ruleId'>,
): string {
  const normalizedProject = normalizeProjectNo(issue.projectNo);
  const projectPart = normalizedProject || `ROW-${issue.rowIndex}`;
  const rulePart = issue.ruleCode ?? issue.ruleId ?? 'RUL-UNKNOWN';
  const payload = [scopeKey, issue.sheetName, projectPart, rulePart].join('|');
  const digest = sha1Hex(payload).slice(0, 6).toUpperCase();
  return `IKY-${digest}`;
}

export function runAudit(file: WorkbookFile, auditPolicy?: AuditPolicy, options: RunAuditOptions = {}): AuditResult {
  const policy = normalizeAuditPolicy(auditPolicy);
  const rules = buildAuditRules(policy);
  const issues: AuditIssue[] = [];
  const sheetResults = file.sheets
    .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
    .map((sheet) => {
      const rows = rowsToObjects(file.rawData[sheet.name] ?? [], sheet.headerRowIndex ?? 0, sheet.normalizedHeaders);
      let flaggedCount = 0;
      rows.forEach(({ row, rowIndex }) => {
        const matches = rules
          .filter((rule) => rule.check(row))
          .sort((a, b) => severityRank[b.defaultSeverity] - severityRank[a.defaultSeverity]);
        if (!matches.length) return;
        flaggedCount += 1;
        const primary = matches[0]!;
        const notes = matches.map((rule) => rule.reason(row)).join('; ');
        const manager = text(row, MANAGER_FIELDS) || 'Unassigned';
        const projectNo = text(row, PROJECT_NO_FIELDS) || `Row ${rowIndex + 1}`;
        const ruleCode = primary.ruleCode;
        issues.push({
          id: `${file.id}-${sheet.name}-${rowIndex}-${ruleCode}`,
          ...(options.issueScope
            ? {
                issueKey: createIssueKey(options.issueScope, { projectNo, sheetName: sheet.name, rowIndex, ruleCode }),
              }
            : {}),
          projectNo,
          projectName: text(row, PROJECT_NAME_FIELDS) || 'Unnamed project',
          sheetName: sheet.name,
          severity: primary.defaultSeverity,
          projectManager: manager,
          projectState: text(row, STATE_FIELDS) || 'Unknown',
          effort: num(row, EFFORT_FIELDS),
          auditStatus: matches.length > 1 ? 'Multiple issues' : primary.ruleCode,
          notes,
          rowIndex,
          email: text(row, EMAIL_FIELDS),
          ruleId: ruleCode,
          ruleCode,
          ruleVersion: primary.version,
          ruleName: primary.name,
          auditRunCode: options.runCode,
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

const keyFor = (issue: AuditIssue) => issue.issueKey ?? auditIssueKey(issue);

// Fields the diff walker compares when deciding whether a shared issue
// changed. Kept in one place so adding a new field ("thresholdLabel",
// "ruleVersion", …) requires a single edit. Order determines the display
// order in per-row diff badges.
const DIFFABLE_FIELDS: readonly DiffableIssueField[] = [
  'severity',
  'projectManager',
  'projectState',
  'effort',
  'auditStatus',
  'email',
  'reason',
  'recommendedAction',
  'category',
] as const;

function normalizeForDiff(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return String(value);
}

function diffIssue(prev: AuditIssue, next: AuditIssue): IssueDiffMap {
  const diffs: IssueDiffMap = {};
  for (const field of DIFFABLE_FIELDS) {
    const a = normalizeForDiff(prev[field]);
    const b = normalizeForDiff(next[field]);
    if (a !== b) {
      (diffs as Record<DiffableIssueField, { from: unknown; to: unknown }>)[field] = {
        from: prev[field],
        to: next[field],
      };
    }
  }
  return diffs;
}

export function compareResults(from: AuditResult, to: AuditResult): ComparisonResult {
  const fromMap = new Map(from.issues.map((issue) => [keyFor(issue), issue]));
  const toMap = new Map(to.issues.map((issue) => [keyFor(issue), issue]));
  const newIssues = to.issues.filter((issue) => !fromMap.has(keyFor(issue)));
  const resolvedIssues = from.issues.filter((issue) => !toMap.has(keyFor(issue)));
  const shared = to.issues.filter((issue) => fromMap.has(keyFor(issue)));

  const changedIssues: ChangedIssue[] = [];
  const unchangedIssues: AuditIssue[] = [];
  for (const issue of shared) {
    const prev = fromMap.get(keyFor(issue))!;
    const diffs = diffIssue(prev, issue);
    if (Object.keys(diffs).length > 0) {
      changedIssues.push({ ...issue, diffs });
    } else {
      unchangedIssues.push(issue);
    }
  }

  return {
    newIssues,
    resolvedIssues,
    changedIssues,
    unchangedIssues,
    managerChanges: changedIssues.filter((i) => i.diffs.projectManager),
    effortChanges: changedIssues.filter((i) => i.diffs.effort),
    stateChanges: changedIssues.filter((i) => i.diffs.projectState),
  };
}

export function buildIssuesCsv(issues: AuditIssue[]): string {
  const header = ['Severity', 'Project No', 'Project Name', 'Manager', 'Sheet', 'State', 'Effort', 'Rule', 'Category', 'Reason', 'Recommended Action'];
  const escape = (cell: unknown) => `"${String(cell ?? '').replaceAll('"', '""')}"`;
  return [header, ...issues.map((issue) => [issue.severity, issue.projectNo, issue.projectName, issue.projectManager, issue.sheetName, issue.projectState, issue.effort, issue.ruleName ?? issue.auditStatus, issue.category ?? '', issue.reason ?? issue.notes, issue.recommendedAction ?? ''])]
    .map((row) => row.map(escape).join(','))
    .join('\n');
}

export function exportIssuesCsv(fileName: string, issues: AuditIssue[]): void {
  const csv = buildIssuesCsv(issues);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
