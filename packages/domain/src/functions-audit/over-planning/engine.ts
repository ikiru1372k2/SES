import { createIssueKey } from '../../audit/auditEngine';
import type { AuditIssue, AuditPolicy, AuditResult, WorkbookFile } from '../../core/types';
import type { FunctionAuditEngine, FunctionAuditOptions, RowObject } from '../types';
import {
  detectPdColumns,
  OP_EMAIL_ALIASES,
  OP_MANAGER_ALIASES,
  OP_PROJECT_NAME_ALIASES,
  OP_PROJECT_NO_ALIASES,
  OP_STATE_ALIASES,
  readCell,
  readManagerName,
  type PdColumnInfo,
} from './columns';
import { OP_MONTH_PD_HIGH_RULE_CODE, OVER_PLANNING_RULES_BY_CODE } from './rules';

export const DEFAULT_PD_THRESHOLD = 30;

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
    worstPd: number;
    worstCol: string;
    pdThreshold: number;
    options: FunctionAuditOptions;
  },
): void {
  const { file, sheetName, rowIndex, row, worstPd, worstCol, pdThreshold, options } = args;
  const rule = OVER_PLANNING_RULES_BY_CODE.get(OP_MONTH_PD_HIGH_RULE_CODE);
  if (!rule) return;

  const projectNo = textValue(row, OP_PROJECT_NO_ALIASES, `Row ${rowIndex + 1}`);
  const projectName = textValue(row, OP_PROJECT_NAME_ALIASES, 'Unnamed project');
  const projectManager = readManagerName(row) || 'Unassigned';
  const projectState = textValue(row, OP_STATE_ALIASES, 'Unknown');
  const email = textValue(row, OP_EMAIL_ALIASES, '');

  const reason = `${worstCol}: ${worstPd} PD exceeds threshold of ${pdThreshold} PD.`;

  issues.push({
    id: `${file.id}-${sheetName}-${rowIndex}-${OP_MONTH_PD_HIGH_RULE_CODE}`,
    ...(options.issueScope
      ? {
          issueKey: createIssueKey(options.issueScope, {
            projectNo,
            sheetName,
            rowIndex,
            ruleCode: OP_MONTH_PD_HIGH_RULE_CODE,
          }),
        }
      : {}),
    projectNo,
    projectName,
    sheetName,
    severity: rule.defaultSeverity,
    projectManager,
    projectState,
    effort: worstPd,
    auditStatus: OP_MONTH_PD_HIGH_RULE_CODE,
    notes: reason,
    rowIndex,
    email,
    ruleId: OP_MONTH_PD_HIGH_RULE_CODE,
    ruleCode: OP_MONTH_PD_HIGH_RULE_CODE,
    ruleVersion: rule.version,
    ruleName: rule.name,
    auditRunCode: options.runCode,
    category: rule.category,
    reason,
    thresholdLabel: `>${pdThreshold} PD`,
    recommendedAction:
      'Review monthly capacity planning and reduce or redistribute PD for this project.',
  });
}

function parsePdRaw(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  const text = String(val).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : null;
}

function auditRow(args: {
  file: WorkbookFile;
  sheetName: string;
  rowIndex: number;
  row: RowObject;
  rawRows: unknown[][];
  pdColumns: PdColumnInfo[];
  pdThreshold: number;
  options: FunctionAuditOptions;
  issues: AuditIssue[];
}): boolean {
  const { file, sheetName, rowIndex, row, rawRows, pdColumns, pdThreshold, options, issues } = args;
  if (pdColumns.length === 0) return false;

  let worstPd = -Infinity;
  let worstCol = '';
  for (const col of pdColumns) {
    const pd = parsePdRaw(rawRows[rowIndex]?.[col.colIndex]);
    if (pd !== null && pd > worstPd) {
      worstPd = pd;
      worstCol = col.label;
    }
  }

  if (worstPd > pdThreshold) {
    pushIssue(issues, { file, sheetName, rowIndex, row, worstPd, worstCol, pdThreshold, options });
    return true;
  }
  return false;
}

export const overPlanningAuditEngine: FunctionAuditEngine = {
  functionId: 'over-planning',
  run(file: WorkbookFile, policy: AuditPolicy | undefined, options: FunctionAuditOptions) {
    const pdThreshold =
      (policy as (AuditPolicy & { pdThreshold?: number }) | undefined)?.pdThreshold ??
      DEFAULT_PD_THRESHOLD;
    const issues: AuditIssue[] = [];
    const sheetResults = file.sheets
      .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
      .map((sheet) => {
        const rawRows = file.rawData[sheet.name] ?? [];
        const pdColumns = detectPdColumns(rawRows);
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
              pdColumns,
              pdThreshold,
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
