import type { AuditResult, SheetAuditResult } from '../types';

export function mergeSheetSummaries(
  engineSheets: SheetAuditResult[],
  aiSheets: SheetAuditResult[],
): SheetAuditResult[] {
  const byName = new Map<string, SheetAuditResult>();
  for (const sheet of engineSheets) {
    byName.set(sheet.sheetName, { ...sheet });
  }
  for (const ai of aiSheets) {
    const existing = byName.get(ai.sheetName);
    if (existing) {
      existing.flaggedCount += ai.flaggedCount;
    } else {
      byName.set(ai.sheetName, { sheetName: ai.sheetName, rowCount: 0, flaggedCount: ai.flaggedCount });
    }
  }
  return [...byName.values()];
}

export function mergeAuditResults(engine: AuditResult, ai: AuditResult): AuditResult {
  return {
    ...engine,
    flaggedRows: engine.flaggedRows + ai.flaggedRows,
    issues: [...engine.issues, ...ai.issues],
    sheets: mergeSheetSummaries(engine.sheets, ai.sheets),
  };
}
