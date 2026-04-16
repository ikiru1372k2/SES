import * as XLSX from 'xlsx';
import type { AuditIssue, AuditResult, SheetInfo, WorkbookFile } from './types';

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

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
  for (const [index, row] of rows.slice(0, HEADER_SCAN_LIMIT).entries()) {
    const candidate = rowHeaderScore(row);
    if (!best || candidate.score > best.score) best = { ...candidate, headerRowIndex: index };
  }
  if (!best || best.score < 5 || !CORE_COLUMNS.some((column) => best.matchedColumns.has(column))) return null;
  return best;
}

function auditableRowCount(rows: unknown[][], headerRowIndex: number): number {
  return rows.slice(headerRowIndex + 1).filter(hasContent).length;
}

function sheetFingerprint(rows: unknown[][]): string {
  return JSON.stringify(rows.filter(hasContent).slice(0, 80));
}

export async function parseWorkbook(file: File): Promise<WorkbookFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const rawData: Record<string, unknown[][]> = {};

  workbook.SheetNames.forEach((name) => {
    const worksheet = workbook.Sheets[name];
    rawData[name] = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', blankrows: true });
  });

  return {
    id: makeId(),
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

    return {
      name,
      status,
      rowCount: header ? auditableRowCount(rows, header.headerRowIndex) : Math.max(0, rows.filter(hasContent).length - 1),
      isSelected: status === 'valid',
      skipReason,
      headerRowIndex: header?.headerRowIndex,
      originalHeaders: header?.originalHeaders,
      normalizedHeaders: header?.normalizedHeaders,
    };
  });
}

export function downloadAuditedWorkbook(file: WorkbookFile, result: AuditResult): void {
  const workbook = XLSX.utils.book_new();
  const auditedSheets = new Set(result.sheets.map((sheet) => sheet.sheetName));

  Object.entries(file.rawData).forEach(([sheetName, rows]) => {
    const sheet = file.sheets.find((item) => item.name === sheetName);
    const headerRowIndex = sheet?.headerRowIndex ?? 0;
    const output = rows.map((row) => [...row]);
    if (auditedSheets.has(sheetName) && output.length > headerRowIndex) {
      output[headerRowIndex] = [...output[headerRowIndex], 'Audit Severity', 'Audit Notes'];
      const issuesByRow = new Map<number, AuditIssue>();
      result.issues.filter((issue) => issue.sheetName === sheetName).forEach((issue) => issuesByRow.set(issue.rowIndex, issue));
      for (let index = headerRowIndex + 1; index < output.length; index += 1) {
        const issue = issuesByRow.get(index);
        output[index] = [...output[index], issue?.severity ?? '', issue?.notes ?? ''];
      }
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(output), sheetName.slice(0, 31));
  });

  const baseName = file.name.replace(/\.(xlsx|xlsm|xls)$/i, '');
  XLSX.writeFile(workbook, `${baseName}_audited.xlsx`);
}
