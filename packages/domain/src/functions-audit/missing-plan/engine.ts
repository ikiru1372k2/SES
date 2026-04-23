import { createIssueKey } from '../../auditEngine';
import type { AuditIssue, AuditResult, WorkbookFile } from '../../types';
import type { FunctionAuditEngine, FunctionAuditOptions, RowObject } from '../types';
import {
  MP_EFFORT_ALIASES,
  MP_EMAIL_ALIASES,
  MP_MANAGER_ALIASES,
  MP_PROJECT_NAME_ALIASES,
  MP_PROJECT_NO_ALIASES,
  MP_STATE_ALIASES,
  readCell,
  readEffortValue,
} from './columns';
import { MISSING_PLAN_RULES_BY_CODE, MP_EFFORT_ZERO_RULE_CODE } from './rules';

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

function rowsToObjects(
  rows: unknown[][],
  headerRowIndex: number,
  normalizedHeaders?: string[],
): Array<{ row: RowObject; rowIndex: number }> {
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
        if (canonicalKey && !canonicalKey.startsWith('column') && row[canonicalKey] === undefined) {
          row[canonicalKey] = cell;
        }
        if (originalKey && row[originalKey] === undefined) {
          row[originalKey] = cell;
        }
      });
      return { row, rowIndex };
    });
}

function textValue(row: RowObject, aliases: readonly string[], fallback = ''): string {
  const raw = readCell(row, aliases);
  if (raw === null || raw === undefined) return fallback;
  const text = String(raw).trim();
  return text || fallback;
}

function pushIssue(
  issues: AuditIssue[],
  args: {
    file: WorkbookFile;
    sheetName: string;
    rowIndex: number;
    row: RowObject;
    effortValue: number;
    options: FunctionAuditOptions;
  },
): void {
  const { file, sheetName, rowIndex, row, effortValue, options } = args;
  const rule = MISSING_PLAN_RULES_BY_CODE.get(MP_EFFORT_ZERO_RULE_CODE);
  if (!rule) return;

  const projectNo = textValue(row, MP_PROJECT_NO_ALIASES, `Row ${rowIndex + 1}`);
  const projectName = textValue(row, MP_PROJECT_NAME_ALIASES, 'Unnamed project');
  const projectManager = textValue(row, MP_MANAGER_ALIASES, 'Unassigned');
  const projectState = textValue(row, MP_STATE_ALIASES, 'Unknown');
  const email = textValue(row, MP_EMAIL_ALIASES, '');

  const reason = `Effort (H) is 0 — no planned effort recorded for this project.`;

  issues.push({
    id: `${file.id}-${sheetName}-${rowIndex}-${MP_EFFORT_ZERO_RULE_CODE}`,
    ...(options.issueScope
      ? {
          issueKey: createIssueKey(options.issueScope, {
            projectNo,
            sheetName,
            rowIndex,
            ruleCode: MP_EFFORT_ZERO_RULE_CODE,
          }),
        }
      : {}),
    projectNo,
    projectName,
    sheetName,
    severity: rule.defaultSeverity,
    projectManager,
    projectState,
    effort: effortValue,
    auditStatus: MP_EFFORT_ZERO_RULE_CODE,
    notes: reason,
    rowIndex,
    email,
    ruleId: MP_EFFORT_ZERO_RULE_CODE,
    ruleCode: MP_EFFORT_ZERO_RULE_CODE,
    ruleVersion: rule.version,
    ruleName: rule.name,
    auditRunCode: options.runCode,
    category: rule.category,
    reason,
    thresholdLabel: '= 0',
    recommendedAction:
      'Enter the planned effort hours for this project in the source system and re-run the audit.',
  });
}

function auditRow(args: {
  file: WorkbookFile;
  sheetName: string;
  rowIndex: number;
  row: RowObject;
  options: FunctionAuditOptions;
  issues: AuditIssue[];
}): boolean {
  const { file, sheetName, rowIndex, row, options, issues } = args;
  const effortValue = readEffortValue(row, MP_EFFORT_ALIASES);

  // Blank / non-numeric cells are not flagged — they indicate the effort
  // column is simply absent or not yet entered, which is a different concern
  // from a deliberate zero entry.
  if (effortValue === null) return false;

  if (effortValue === 0) {
    pushIssue(issues, { file, sheetName, rowIndex, row, effortValue, options });
    return true;
  }

  return false;
}

export const missingPlanAuditEngine: FunctionAuditEngine = {
  functionId: 'missing-plan',
  run(file, _policy, options) {
    const issues: AuditIssue[] = [];
    const sheetResults = file.sheets
      .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
      .map((sheet) => {
        const rows = rowsToObjects(
          file.rawData[sheet.name] ?? [],
          sheet.headerRowIndex ?? 0,
          sheet.normalizedHeaders,
        );
        let flaggedCount = 0;
        rows.forEach(({ row, rowIndex }) => {
          const flagged = auditRow({
            file,
            sheetName: sheet.name,
            rowIndex,
            row,
            options,
            issues,
          });
          if (flagged) flaggedCount += 1;
        });
        return { sheetName: sheet.name, rowCount: rows.length, flaggedCount };
      });

    const result: AuditResult = {
      fileId: file.id,
      runAt: new Date().toISOString(),
      scannedRows: sheetResults.reduce((sum, sheet) => sum + sheet.rowCount, 0),
      flaggedRows: sheetResults.reduce((sum, sheet) => sum + sheet.flaggedCount, 0),
      issues,
      sheets: sheetResults,
    };
    return result;
  },
};
