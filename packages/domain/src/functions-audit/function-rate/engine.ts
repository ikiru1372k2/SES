import { createIssueKey } from '../../auditEngine';
import type { AuditIssue, AuditPolicy, AuditResult, WorkbookFile } from '../../types';
import type { FunctionAuditEngine, FunctionAuditOptions, RowObject } from '../types';
import {
  FR_EMAIL_ALIASES,
  FR_FUNCTION_ALIASES,
  FR_MANAGER_ALIASES,
  FR_PROJECT_NAME_ALIASES,
  FR_PROJECT_NO_ALIASES,
  classifyRateCell,
  detectRateColumns,
  readCell,
  type RateColumnInfo,
} from './columns';
import { FR_RATE_ZERO_RULE_CODE, FUNCTION_RATE_RULES_BY_CODE } from './rules';

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
    missingMonths: string[];
    options: FunctionAuditOptions;
  },
): void {
  const { file, sheetName, rowIndex, row, missingMonths, options } = args;
  const rule = FUNCTION_RATE_RULES_BY_CODE.get(FR_RATE_ZERO_RULE_CODE);
  if (!rule) return;

  const projectNo = textValue(row, FR_PROJECT_NO_ALIASES, `Row ${rowIndex + 1}`);
  const projectName = textValue(row, FR_PROJECT_NAME_ALIASES, 'Unnamed project');
  const projectManager = textValue(row, FR_MANAGER_ALIASES, 'Unassigned');
  const email = textValue(row, FR_EMAIL_ALIASES, '');
  const fn = textValue(row, FR_FUNCTION_ALIASES, '');

  const zeroMonthCount = missingMonths.length;
  const monthList = missingMonths.join(', ');
  const reason =
    zeroMonthCount === 1
      ? `External rate is 0 for ${monthList}.`
      : `External rate is 0 for ${zeroMonthCount} months: ${monthList}.`;

  issues.push({
    id: `${file.id}-${sheetName}-${rowIndex}-${FR_RATE_ZERO_RULE_CODE}`,
    ...(options.issueScope
      ? {
          issueKey: createIssueKey(options.issueScope, {
            projectNo,
            sheetName,
            rowIndex,
            ruleCode: FR_RATE_ZERO_RULE_CODE,
          }),
        }
      : {}),
    projectNo,
    projectName,
    sheetName,
    severity: rule.defaultSeverity,
    projectManager,
    projectState: fn || 'Unknown',
    effort: zeroMonthCount,
    auditStatus: FR_RATE_ZERO_RULE_CODE,
    notes: reason,
    rowIndex,
    email,
    ruleId: FR_RATE_ZERO_RULE_CODE,
    ruleCode: FR_RATE_ZERO_RULE_CODE,
    ruleVersion: rule.version,
    ruleName: rule.name,
    auditRunCode: options.runCode,
    category: rule.category,
    reason,
    thresholdLabel: '= 0',
    recommendedAction:
      'Enter the external rate for the flagged months in the source system and re-run the audit.',
    missingMonths,
    zeroMonthCount,
  });
}

function auditRow(args: {
  file: WorkbookFile;
  sheetName: string;
  rowIndex: number;
  row: RowObject;
  rawRows: unknown[][];
  rateColumns: RateColumnInfo[];
  options: FunctionAuditOptions;
  issues: AuditIssue[];
}): boolean {
  const { file, sheetName, rowIndex, row, rawRows, rateColumns, options, issues } = args;
  if (rateColumns.length === 0) return false;

  const missingMonths: string[] = [];
  for (const col of rateColumns) {
    if (classifyRateCell(rawRows, rowIndex, col.colIndex) === 'zero') {
      missingMonths.push(col.label);
    }
  }

  if (missingMonths.length > 0) {
    pushIssue(issues, { file, sheetName, rowIndex, row, missingMonths, options });
    return true;
  }
  return false;
}

export const functionRateAuditEngine: FunctionAuditEngine = {
  functionId: 'function-rate',
  run(file: WorkbookFile, _policy: AuditPolicy | undefined, options: FunctionAuditOptions) {
    void _policy;
    const issues: AuditIssue[] = [];
    const sheetResults = file.sheets
      .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
      .map((sheet) => {
        const rawRows = file.rawData[sheet.name] ?? [];
        const rateColumns = detectRateColumns(rawRows);
        const rows = rowsToObjects(rawRows, sheet.headerRowIndex ?? 0, sheet.normalizedHeaders);
        let flaggedCount = 0;
        rows.forEach(({ row, rowIndex }) => {
          if (
            auditRow({
              file,
              sheetName: sheet.name,
              rowIndex,
              row,
              rawRows,
              rateColumns,
              options,
              issues,
            })
          ) {
            flaggedCount += 1;
          }
        });
        return { sheetName: sheet.name, rowCount: rows.length, flaggedCount };
      });

    const result: AuditResult = {
      fileId: file.id,
      runAt: new Date().toISOString(),
      scannedRows: sheetResults.reduce((sum, s) => sum + s.rowCount, 0),
      flaggedRows: sheetResults.reduce((sum, s) => sum + s.flaggedCount, 0),
      issues,
      sheets: sheetResults,
    };
    return result;
  },
};
