import type { AuditProcess, AuditResult, WorkbookFile } from '../domain/types';

export type AuditMetrics = {
  scannedRows: number;
  flaggedRows: number;
  issues: number;
  sheetsAudited: number;
  aiIssues: number;
};

function isAiCode(code: string | undefined | null): boolean {
  return !!code && code.startsWith('ai_');
}

export function getSelectedSheetNames(file: WorkbookFile): Set<string> {
  const names = new Set<string>();
  for (const sheet of file.sheets) {
    if (sheet.status === 'valid' && sheet.isSelected) {
      names.add(sheet.name);
    }
  }
  return names;
}

function countFlaggedRowsFromIssues(issues: AuditResult['issues'], scannedRows: number): number {
  const rowKeys = new Set<string>();
  for (const issue of issues) {
    if (isAiCode(issue.ruleCode ?? issue.ruleId)) continue;
    if (issue.rowIndex == null) continue;
    rowKeys.add(`${issue.sheetName}::${issue.rowIndex}`);
  }
  return Math.min(rowKeys.size, scannedRows);
}

export function computeAuditMetrics(result: AuditResult): AuditMetrics {
  const engineIssues = result.issues.filter((i) => !isAiCode(i.ruleCode ?? i.ruleId));
  const aiIssues = result.issues.filter((i) => isAiCode(i.ruleCode ?? i.ruleId));
  return {
    scannedRows: result.scannedRows,
    flaggedRows: countFlaggedRowsFromIssues(result.issues, result.scannedRows),
    issues: engineIssues.length,
    sheetsAudited: result.sheets.length,
    aiIssues: aiIssues.length,
  };
}

export function filterAuditResultBySelectedSheets(
  result: AuditResult,
  file: WorkbookFile,
): AuditResult | null {
  if (result.fileId !== file.id) return null;

  const selected = getSelectedSheetNames(file);
  if (selected.size === 0) {
    return {
      ...result,
      issues: [],
      sheets: [],
      scannedRows: 0,
      flaggedRows: 0,
    };
  }

  const issues = result.issues.filter((issue) => selected.has(issue.sheetName));
  const sheets = result.sheets.filter((sheet) => selected.has(sheet.sheetName));
  const scannedRows = sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  const flaggedRows = countFlaggedRowsFromIssues(issues, scannedRows);

  return {
    ...result,
    issues,
    sheets,
    scannedRows,
    flaggedRows,
  };
}

export const EMPTY_AUDIT_METRICS: AuditMetrics = {
  scannedRows: 0,
  flaggedRows: 0,
  issues: 0,
  sheetsAudited: 0,
  aiIssues: 0,
};

/** Audit result for the workspace summary: scoped to active file only. */
export function resolveWorkspaceAuditResult(
  process: AuditProcess | undefined,
  activeFile: WorkbookFile | undefined,
  sessionResult: AuditResult | null,
): AuditResult | null {
  if (!process || !activeFile) return null;

  if (sessionResult?.fileId === activeFile.id) {
    return sessionResult;
  }
  if (process.latestAuditResult?.fileId === activeFile.id) {
    return process.latestAuditResult;
  }
  const savedForFile = process.versions.find((version) => version.result.fileId === activeFile.id);
  return savedForFile?.result ?? null;
}

export function filterAuditResultForActiveFile(
  result: AuditResult | null,
  file: WorkbookFile | undefined,
): AuditResult | null {
  if (!file || !result) return null;
  if (result.fileId !== file.id) return null;
  return filterAuditResultBySelectedSheets(result, file);
}

export function resolveWorkspaceMetrics(
  process: AuditProcess | undefined,
  activeFile: WorkbookFile | undefined,
  sessionResult: AuditResult | null,
): AuditMetrics {
  const base = resolveWorkspaceAuditResult(process, activeFile, sessionResult);
  const filtered = filterAuditResultForActiveFile(base, activeFile);
  return filtered ? computeAuditMetrics(filtered) : EMPTY_AUDIT_METRICS;
}
