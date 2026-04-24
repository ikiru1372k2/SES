import { createIssueKey } from '../../auditEngine';
import type { AuditIssue, AuditPolicy, AuditResult, WorkbookFile } from '../../types';
import type { FunctionAuditEngine, FunctionAuditOptions, RowObject } from '../types';
import {
  ICR_EMAIL_ALIASES,
  ICR_FUNCTION_ALIASES,
  ICR_MANAGER_ALIASES,
  ICR_PROJECT_NAME_ALIASES,
  ICR_PROJECT_NO_ALIASES,
  classifyCostRateCell,
  detectCostRateColumns,
  readCell,
  type CostRateColumnInfo,
} from './columns';
import { ICR_COST_ZERO_RULE_CODE, INTERNAL_COST_RATE_RULES_BY_CODE } from './rules';

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
  const rule = INTERNAL_COST_RATE_RULES_BY_CODE.get(ICR_COST_ZERO_RULE_CODE);
  if (!rule) return;

  const projectNo = textValue(row, ICR_PROJECT_NO_ALIASES, `Row ${rowIndex + 1}`);
  const projectName = textValue(row, ICR_PROJECT_NAME_ALIASES, 'Unnamed project');
  const projectManager = textValue(row, ICR_MANAGER_ALIASES, 'Unassigned');
  const email = textValue(row, ICR_EMAIL_ALIASES, '');
  const fn = textValue(row, ICR_FUNCTION_ALIASES, '');

  const zeroMonthCount = missingMonths.length;
  const monthList = missingMonths.join(', ');
  const reason =
    zeroMonthCount === 1
      ? `Internal cost rate is 0 for ${monthList}.`
      : `Internal cost rate is 0 for ${zeroMonthCount} months: ${monthList}.`;

  issues.push({
    id: `${file.id}-${sheetName}-${rowIndex}-${ICR_COST_ZERO_RULE_CODE}`,
    ...(options.issueScope
      ? {
          issueKey: createIssueKey(options.issueScope, {
            projectNo,
            sheetName,
            rowIndex,
            ruleCode: ICR_COST_ZERO_RULE_CODE,
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
    auditStatus: ICR_COST_ZERO_RULE_CODE,
    notes: reason,
    rowIndex,
    email,
    ruleId: ICR_COST_ZERO_RULE_CODE,
    ruleCode: ICR_COST_ZERO_RULE_CODE,
    ruleVersion: rule.version,
    ruleName: rule.name,
    auditRunCode: options.runCode,
    category: rule.category,
    reason,
    thresholdLabel: '= 0',
    recommendedAction:
      'Enter the internal cost rate for the flagged months in the source system and re-run the audit.',
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
  costRateColumns: CostRateColumnInfo[];
  options: FunctionAuditOptions;
  issues: AuditIssue[];
}): boolean {
  const { file, sheetName, rowIndex, row, rawRows, costRateColumns, options, issues } = args;
  if (costRateColumns.length === 0) return false;

  const missingMonths: string[] = [];
  for (const col of costRateColumns) {
    if (classifyCostRateCell(rawRows, rowIndex, col.colIndex) === 'zero') {
      missingMonths.push(col.label);
    }
  }

  if (missingMonths.length > 0) {
    pushIssue(issues, { file, sheetName, rowIndex, row, missingMonths, options });
    return true;
  }
  return false;
}

export const internalCostRateAuditEngine: FunctionAuditEngine = {
  functionId: 'internal-cost-rate',
  run(file: WorkbookFile, _policy: AuditPolicy | undefined, options: FunctionAuditOptions) {
    void _policy;
    const issues: AuditIssue[] = [];
    const sheetResults = file.sheets
      .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
      .map((sheet) => {
        const rawRows = file.rawData[sheet.name] ?? [];
        const costRateColumns = detectCostRateColumns(rawRows);
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
              costRateColumns,
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
