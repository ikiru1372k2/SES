import ExcelJS from "exceljs";
import { REQUIRED_HEADERS, SETTINGS } from "./config.js";
import type { DetectedSheetMetadata, EffortRow, WorkbookTemplateInfo } from "./types.js";

function readHeaderValues(worksheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  return REQUIRED_HEADERS.map((_, index) => {
    const value = worksheet.getRow(rowNumber).getCell(index + 1).value;
    return value == null ? "" : String(value).trim();
  });
}

function normalizeText(value: ExcelJS.CellValue | null): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim();
  }

  return String(value).trim();
}

function normalizeEffort(value: ExcelJS.CellValue | null): { parsed: number | null; raw: unknown } {
  if (typeof value === "number") {
    return { parsed: value, raw: value };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { parsed: null, raw: value };
    }

    const parsed = Number(trimmed);
    return { parsed: Number.isFinite(parsed) ? parsed : null, raw: value };
  }

  if (value == null) {
    return { parsed: null, raw: value };
  }

  return { parsed: null, raw: value };
}

export async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

export async function loadWorkbookFromBuffer(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return workbook;
}

export function inspectWorkbook(workbook: ExcelJS.Workbook): DetectedSheetMetadata[] {
  const sheetFacts = workbook.worksheets.map((sheet) => {
    const header = readHeaderValues(sheet, SETTINGS.headerRow);
    const auditable = header.every((value, index) => value === REQUIRED_HEADERS[index]);
    const signature = auditable
      ? Array.from({ length: Math.max(0, sheet.rowCount - SETTINGS.firstDataRow + 1) }, (_, rowOffset) => {
          const rowNumber = SETTINGS.firstDataRow + rowOffset;
          return REQUIRED_HEADERS.map((_, index) =>
            normalizeText(sheet.getRow(rowNumber).getCell(index + 1).value),
          ).join("||");
        }).join("##")
      : "";

    return {
      name: sheet.name,
      auditable,
      duplicate: false,
      rowCount: sheet.rowCount,
      reason: auditable ? undefined : `Row ${SETTINGS.headerRow} does not match the expected audit template.`,
      signature,
    };
  });

  const seenSignatures = new Set<string>();
  for (const fact of sheetFacts) {
    if (!fact.auditable) {
      continue;
    }

    if (seenSignatures.has(fact.signature)) {
      fact.duplicate = true;
      fact.reason = "Duplicate/reference tab";
      continue;
    }

    seenSignatures.add(fact.signature);
  }

  return sheetFacts.map(({ signature, ...fact }) => fact);
}

export function detectTemplate(workbook: ExcelJS.Workbook): WorkbookTemplateInfo {
  const inspectedSheets = inspectWorkbook(workbook);
  const templateSheetNames = inspectedSheets.filter((sheet) => sheet.auditable).map((sheet) => sheet.name);
  const templateSheets = workbook.worksheets.filter((sheet) => templateSheetNames.includes(sheet.name));

  if (templateSheets.length === 0) {
    throw new Error(`No worksheet matched the expected effort template on row ${SETTINGS.headerRow}.`);
  }

  const sourceSheet =
    templateSheets.find((sheet) => sheet.name === SETTINGS.sourceSheetName) ?? templateSheets[0];

  const scannedSheetNames = inspectedSheets.filter((sheet) => sheet.auditable && !sheet.duplicate).map((sheet) => sheet.name);
  const duplicateSheetNames = inspectedSheets.filter((sheet) => sheet.duplicate).map((sheet) => sheet.name);

  return {
    sourceSheetName: sourceSheet.name,
    scannedSheetNames,
    duplicateSheetNames,
    headerRow: SETTINGS.headerRow,
    firstDataRow: SETTINGS.firstDataRow,
  };
}

export function normalizeRows(workbook: ExcelJS.Workbook, template: WorkbookTemplateInfo): EffortRow[] {
  const rows: EffortRow[] = [];

  for (const sheetName of template.scannedSheetNames) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Unable to find source worksheet "${sheetName}".`);
    }

    for (let rowNumber = template.firstDataRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const rawValues = REQUIRED_HEADERS.map((_, index) => row.getCell(index + 1).value);
      const isEmpty = rawValues.every((value) => value == null || String(value).trim() === "");
      if (isEmpty) {
        continue;
      }

      const { parsed: effortHours, raw: rawEffortValue } = normalizeEffort(row.getCell(12).value);

      rows.push({
        sourceSheetName: sheetName,
        sourceRowNumber: rowNumber,
        country: normalizeText(row.getCell(1).value),
        businessUnit: normalizeText(row.getCell(2).value),
        customerName: normalizeText(row.getCell(3).value),
        projectNo: normalizeText(row.getCell(4).value),
        project: normalizeText(row.getCell(5).value),
        projectState: normalizeText(row.getCell(6).value),
        projectCountryManager: normalizeText(row.getCell(7).value),
        projectManager: normalizeText(row.getCell(8).value),
        email: normalizeText(row.getCell(9).value),
        projectCategory: normalizeText(row.getCell(10).value),
        pspType: normalizeText(row.getCell(11).value),
        effortHours,
        rawEffortValue,
      });
    }
  }

  return rows;
}
