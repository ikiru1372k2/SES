import type ExcelJS from 'exceljs';
import { MAX_WORKBOOK_FILE_SIZE_BYTES } from '@ses/domain';
import { auditIssueKey } from './auditEngine';
import { createId } from './id';
import type { AuditIssue, AuditResult, IssueCorrection, SheetInfo, WorkbookFile } from './types';

export { MAX_WORKBOOK_FILE_SIZE_BYTES };
const HEADER_SCAN_LIMIT = 20;
const DUPLICATE_NAME_RE = /summary|ref|lookup/i;
const COLUMN_ALIASES: Record<string, string[]> = {
  country: ['country'],
  businessUnit: ['business unit', 'business unit project', 'unit'],
  customer: ['customer', 'customer name'],
  projectNo: ['project no', 'project no.', 'project number', 'project id'],
  projectName: ['project', 'project name', 'name'],
  projectState: ['project state', 'state'],
  countryManager: ['project country manager', 'country manager'],
  projectManager: ['project manager', 'manager'],
  email: ['email', 'manager email', 'project manager email'],
  effort: ['effort', 'hours', 'effort h', 'effort (h)', 'planned effort'],
  status: ['status', 'audit status'],
};
const CORE_COLUMNS = ['projectNo', 'projectManager', 'projectState', 'effort'];

type HeaderCandidate = {
  headerRowIndex: number;
  originalHeaders: string[];
  normalizedHeaders: string[];
  score: number;
  matchedColumns: Set<string>;
};

function hasContent(row: unknown[]): boolean {
  return row.some((cell) => String(cell ?? '').trim() !== '');
}

function normalizeHeaderLabel(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, (match) => ` ${match.slice(1, -1)} `)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalHeader(value: unknown): string | null {
  const normalized = normalizeHeaderLabel(value);
  if (!normalized) return null;
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((alias) => normalized === normalizeHeaderLabel(alias))) return canonical;
  }
  return null;
}

function rowHeaderScore(row: unknown[]): { score: number; normalizedHeaders: string[]; originalHeaders: string[]; matchedColumns: Set<string> } {
  const originalHeaders = row.map((cell) => String(cell ?? '').trim());
  const normalizedHeaders = originalHeaders.map((cell, index) => canonicalHeader(cell) ?? (cell ? `column${index + 1}` : ''));
  const matchedColumns = new Set(normalizedHeaders.filter(Boolean).filter((header) => !header.startsWith('column')));
  const coreMatches = CORE_COLUMNS.filter((column) => matchedColumns.has(column)).length;
  return {
    score: matchedColumns.size + coreMatches * 2,
    normalizedHeaders,
    originalHeaders,
    matchedColumns,
  };
}

function detectHeader(rows: unknown[][]): HeaderCandidate | null {
  let best: HeaderCandidate | null = null;
  const scanLength = Math.min(rows.length, HEADER_SCAN_LIMIT);
  for (let index = 0; index < scanLength; index += 1) {
    const row = rows[index] ?? [];
    const candidate = rowHeaderScore(row);
    if (!best || candidate.score > best.score) best = { ...candidate, headerRowIndex: index };
  }
  if (!best || best.score < 4 || !CORE_COLUMNS.some((column) => best.matchedColumns.has(column))) return null;
  return best;
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
    const header = detectHeader(rows);

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
