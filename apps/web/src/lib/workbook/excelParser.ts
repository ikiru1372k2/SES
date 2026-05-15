import type ExcelJS from 'exceljs';
import { MAX_WORKBOOK_FILE_SIZE_BYTES } from '@ses/domain';
import { auditIssueKey } from '../domain/auditEngine';
import { createId } from '../domain/id';
import { detectHeader } from './workbookDetection';
import type { AuditIssue, AuditResult, IssueCorrection, SheetInfo, WorkbookFile } from '../domain/types';

export { MAX_WORKBOOK_FILE_SIZE_BYTES };
const HEADER_SCAN_LIMIT = 20;
const DUPLICATE_NAME_RE = /summary|ref|lookup/i;

function hasContent(row: unknown[]): boolean {
  return row.some((cell) => String(cell ?? '').trim() !== '');
}

function auditableRowCount(rows: unknown[][], headerRowIndex: number): number {
  return rows.slice(headerRowIndex + 1).filter(hasContent).length;
}

function sheetFingerprint(rows: unknown[][]): string {
  return JSON.stringify(rows.filter(hasContent).slice(0, 80));
}

function cellValueToPrimitive(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if ('result' in value) return cellValueToPrimitive(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text ?? '');
  if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
  return String(value);
}

function worksheetToRows(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  const rowCount = worksheet.rowCount;
  const columnCount = worksheet.columnCount;
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values: unknown[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      values.push(cellValueToPrimitive(row.getCell(columnNumber).value));
    }
    rows.push(values);
  }
  return rows;
}

function uniqueSheetName(name: string, usedNames: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let suffix = 1;
  while (usedNames.has(candidate)) {
    suffix += 1;
    const suffixText = ` (${suffix})`;
    candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
  }
  usedNames.add(candidate);
  return candidate;
}

export function validateWorkbookFile(file: File): void {
  if (/\.xls$/i.test(file.name)) {
    throw new Error('Legacy .xls files are not supported. Please save the workbook as .xlsx or .xlsm and upload again.');
  }
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    throw new Error(`${file.name} is not a supported Excel workbook. Upload .xlsx or .xlsm files.`);
  }
  if (file.size > MAX_WORKBOOK_FILE_SIZE_BYTES) {
    throw new Error(`${file.name} is too large. Upload workbooks up to 10 MB.`);
  }
}

export async function parseWorkbook(file: File): Promise<WorkbookFile> {
  validateWorkbookFile(file);
  const ExcelJS = (await import('exceljs')).default;
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rawData: Record<string, unknown[][]> = {};

  workbook.eachSheet((worksheet) => {
    rawData[worksheet.name] = worksheetToRows(worksheet);
  });

  return {
    id: createId(),
    name: file.name,
    uploadedAt: new Date().toISOString(),
    lastAuditedAt: null,
    isAudited: false,
    sheets: detectWorkbookSheets(rawData),
    rawData,
  };
}

export function detectWorkbookSheets(rawData: Record<string, unknown[][]>): SheetInfo[] {
  const seen = new Map<string, string>();

  return Object.entries(rawData).map(([name, rows]) => {
    const fingerprint = sheetFingerprint(rows);
    const duplicateOf = seen.get(fingerprint);
    if (!duplicateOf) seen.set(fingerprint, name);
    const header = detectHeader(rows, HEADER_SCAN_LIMIT);

    let status: SheetInfo['status'] = 'valid';
    let skipReason: string | undefined;
    if (DUPLICATE_NAME_RE.test(name)) {
      status = 'duplicate';
      skipReason = 'Duplicate/reference tab';
    } else if (duplicateOf) {
      status = 'duplicate';
      skipReason = `Duplicate of ${duplicateOf}`;
    } else if (rows.length < 5 || !header) {
      status = 'invalid';
      skipReason = rows.length < 5 ? 'Too few rows for audit' : 'Template headers not recognized in first 20 rows';
    }

    const info: SheetInfo = {
      name,
      status,
      rowCount: header ? auditableRowCount(rows, header.headerRowIndex) : Math.max(0, rows.filter(hasContent).length - 1),
      isSelected: status === 'valid',
    };
    if (skipReason) info.skipReason = skipReason;
    if (header) {
      info.headerRowIndex = header.headerRowIndex;
      info.originalHeaders = header.originalHeaders;
      info.normalizedHeaders = header.normalizedHeaders;
    }
    return info;
  });
}

export async function downloadAuditedWorkbook(file: WorkbookFile, result: AuditResult, corrections: Record<string, IssueCorrection> = {}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const auditedSheets = new Set(result.sheets.map((sheet) => sheet.sheetName));
  const usedSheetNames = new Set<string>();
  const includeCorrections = Object.keys(corrections).length > 0;

  Object.entries(file.rawData).forEach(([sheetName, rows]) => {
    const sheet = file.sheets.find((item) => item.name === sheetName);
    const headerRowIndex = sheet?.headerRowIndex ?? 0;
    const output = rows.map((row) => [...row]);
    if (auditedSheets.has(sheetName) && output.length > headerRowIndex) {
      output[headerRowIndex] = [
        ...(output[headerRowIndex] ?? []),
        'Audit Severity',
        'Audit Notes',
        ...(includeCorrections ? ['Corrected Effort', 'Corrected State', 'Corrected Manager', 'Correction Note'] : []),
      ];
      const issuesByRow = new Map<number, AuditIssue>();
      result.issues.filter((issue) => issue.sheetName === sheetName).forEach((issue) => issuesByRow.set(issue.rowIndex, issue));
      for (let index = headerRowIndex + 1; index < output.length; index += 1) {
        const issue = issuesByRow.get(index);
        const correction = issue ? corrections[auditIssueKey(issue)] : undefined;
        output[index] = [
          ...(output[index] ?? []),
          issue?.severity ?? '',
          issue?.notes ?? '',
          ...(includeCorrections ? [correction?.effort ?? '', correction?.projectState ?? '', correction?.projectManager ?? '', correction?.note ?? ''] : []),
        ];
      }
    }
    const worksheet = workbook.addWorksheet(uniqueSheetName(sheetName, usedSheetNames));
    output.forEach((row) => worksheet.addRow(row));
  });

  const baseName = file.name.replace(/\.(xlsx|xlsm)$/i, '');
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}_${includeCorrections ? 'corrected' : 'audited'}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
