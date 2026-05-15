import type { AuditIssue, AuditResult, SheetAuditResult } from '../core/types';

function countDistinctFlaggedRows(issues: AuditIssue[], sheetName?: string): number {
  const keys = new Set<string>();
  for (const issue of issues) {
    if (sheetName && issue.sheetName !== sheetName) continue;
    if (issue.rowIndex == null) continue;
    keys.add(`${issue.sheetName}::${issue.rowIndex}`);
  }
  return keys.size;
}

export function mergeSheetSummaries(
  engineSheets: SheetAuditResult[],
  aiSheets: SheetAuditResult[],
  mergedIssues: AuditIssue[],
): SheetAuditResult[] {
  const byName = new Map<string, SheetAuditResult>();
  for (const sheet of engineSheets) {
    byName.set(sheet.sheetName, { ...sheet });
  }
  for (const ai of aiSheets) {
    if (!byName.has(ai.sheetName)) {
      byName.set(ai.sheetName, { sheetName: ai.sheetName, rowCount: 0, flaggedCount: 0 });
    }
  }
  // Recompute flaggedCount per sheet from the merged issue set so a row that
  // triggers both an engine rule and an AI pilot rule is counted once.
  for (const sheet of byName.values()) {
    sheet.flaggedCount = countDistinctFlaggedRows(mergedIssues, sheet.sheetName);
  }
  return [...byName.values()];
}

export function mergeAuditResults(engine: AuditResult, ai: AuditResult): AuditResult {
  const issues = [...engine.issues, ...ai.issues];
  const sheets = mergeSheetSummaries(engine.sheets, ai.sheets, issues);
  return {
    ...engine,
    flaggedRows: sheets.reduce((sum, s) => sum + s.flaggedCount, 0),
    issues,
    sheets,
  };
}
