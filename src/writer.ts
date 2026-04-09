import path from "node:path";
import ExcelJS from "exceljs";
import { REQUIRED_HEADERS, SETTINGS } from "./config.js";
import type { AuditedRow, Severity } from "./types.js";
import { ensureDir } from "./utils.js";

function applyRowHighlight(row: ExcelJS.Row, severity: Severity | null): void {
  if (!severity) {
    return;
  }

  const fill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: SETTINGS.severityColors[severity] },
  };

  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = fill;
  });
}

function getAuditColumnStart(worksheet: ExcelJS.Worksheet): number {
  const headerRow = worksheet.getRow(SETTINGS.headerRow);

  for (let index = 1; index <= headerRow.cellCount; index += 1) {
    const value = String(headerRow.getCell(index).value ?? "").trim();
    if (value === SETTINGS.auditColumns[0]) {
      return index;
    }
  }

  return REQUIRED_HEADERS.length + 1;
}

export async function writeAuditWorkbook(
  workbook: ExcelJS.Workbook,
  rows: AuditedRow[],
): Promise<string> {
  const rowsBySheet = new Map<string, AuditedRow[]>();
  for (const row of rows) {
    const existing = rowsBySheet.get(row.sourceSheetName) ?? [];
    existing.push(row);
    rowsBySheet.set(row.sourceSheetName, existing);
  }

  for (const [sheetName, sheetRows] of rowsBySheet.entries()) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Worksheet "${sheetName}" not found for audit write-back.`);
    }

    const auditStartColumn = getAuditColumnStart(worksheet);
    const headerRow = worksheet.getRow(SETTINGS.headerRow);
    SETTINGS.auditColumns.forEach((header, offset) => {
      headerRow.getCell(auditStartColumn + offset).value = header;
    });

    for (const row of sheetRows) {
      const sheetRow = worksheet.getRow(row.sourceRowNumber);
      sheetRow.getCell(auditStartColumn).value = row.auditStatus;
      sheetRow.getCell(auditStartColumn + 1).value = row.auditSeverity;
      sheetRow.getCell(auditStartColumn + 2).value = row.auditNotes;
      applyRowHighlight(sheetRow, row.highestSeverity);
    }

    worksheet.columns.forEach((column) => {
      column.width = Math.max(column.width ?? 10, 18);
    });
  }

  ensureDir(SETTINGS.outputDir);
  const outputPath = path.resolve(SETTINGS.outputDir, SETTINGS.auditedWorkbookName);
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}
