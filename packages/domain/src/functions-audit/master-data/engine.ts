import { createIssueKey } from '../../auditEngine';
import type { AuditIssue, AuditResult, WorkbookFile } from '../../types';
import { isBadValue, isOthersToken } from '../bad-values';
import type { FunctionAuditEngine, FunctionAuditOptions, RowObject } from '../types';
import {
  MD_COLUMNS,
  MD_EMAIL_ALIASES,
  MD_PROJECT_NAME_ALIASES,
  MD_PROJECT_NO_ALIASES,
  MD_REQUIRED_COLUMNS,
  MD_STATE_ALIASES,
  readCell,
} from './columns';
import {
  MASTER_DATA_RULES_BY_CODE,
  MD_REVIEW_OTHERS_RULE_CODE,
  missingFieldRuleCode,
} from './rules';

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
    ruleCode: string;
    observed: unknown;
    message: string;
    options: FunctionAuditOptions;
  },
): void {
  const { file, sheetName, rowIndex, row, ruleCode, observed, message, options } = args;
  const rule = MASTER_DATA_RULES_BY_CODE.get(ruleCode);
  if (!rule) return;

  const projectNo = textValue(row, MD_PROJECT_NO_ALIASES, `Row ${rowIndex + 1}`);
  const projectName = textValue(row, MD_PROJECT_NAME_ALIASES, 'Unnamed project');
  const projectManager = textValue(row, MD_COLUMNS.projectManager.aliases, 'Unassigned');
  const projectState = textValue(row, MD_STATE_ALIASES, 'Unknown');
  const email = textValue(row, MD_EMAIL_ALIASES, '');

  const observedText = observed === null || observed === undefined ? '' : String(observed).trim();
  const truncatedObserved = observedText.length > 60 ? `${observedText.slice(0, 57)}…` : observedText;
  const reason = truncatedObserved ? `${message} (found: "${truncatedObserved}")` : message;

  issues.push({
    id: `${file.id}-${sheetName}-${rowIndex}-${ruleCode}`,
    ...(options.issueScope
      ? { issueKey: createIssueKey(options.issueScope, { projectNo, sheetName, rowIndex, ruleCode }) }
      : {}),
    projectNo,
    projectName,
    sheetName,
    severity: rule.defaultSeverity,
    projectManager,
    projectState,
    effort: 0,
    auditStatus: ruleCode,
    notes: reason,
    rowIndex,
    email,
    ruleId: ruleCode,
    ruleCode,
    ruleVersion: rule.version,
    ruleName: rule.name,
    auditRunCode: options.runCode,
    category: rule.category,
    reason,
    thresholdLabel: rule.category === 'Needs Review' ? 'Manual review' : 'Required field',
    recommendedAction:
      rule.category === 'Needs Review'
        ? 'Confirm the actual product with the project team and update the master record.'
        : 'Populate the field in the source master system and re-run the audit.',
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
  let flagged = false;

  for (const column of MD_REQUIRED_COLUMNS) {
    const raw = readCell(row, column.aliases);
    if (isBadValue(raw)) {
      flagged = true;
      pushIssue(issues, {
        file,
        sheetName,
        rowIndex,
        row,
        ruleCode: missingFieldRuleCode(column.id),
        observed: raw,
        message: `${column.label} is missing or uses a placeholder value.`,
        options,
      });
    }
  }

  const product = readCell(row, MD_COLUMNS.projectProduct.aliases);
  // If the product is already flagged as missing, don't also flag it for
  // "needs review" — that would double-count the same cell.
  if (!isBadValue(product) && isOthersToken(product)) {
    flagged = true;
    pushIssue(issues, {
      file,
      sheetName,
      rowIndex,
      row,
      ruleCode: MD_REVIEW_OTHERS_RULE_CODE,
      observed: product,
      message: 'Project Product is "Other/Others" — auditor review required.',
      options,
    });
  }

  return flagged;
}

export const masterDataAuditEngine: FunctionAuditEngine = {
  functionId: 'master-data',
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
