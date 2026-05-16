import type { RowObject } from '../types';

export const FR_PROJECT_NO_ALIASES: readonly string[] = [
  'Project ID',
  'Project No.',
  'Project No',
  'Project Number',
  'projectNo',
];
export const FR_PROJECT_NAME_ALIASES: readonly string[] = [
  'Project Name',
  'Project',
  'projectName',
  'Name',
];
export const FR_EMPLOYEE_ALIASES: readonly string[] = ['Employee Name', 'employeeName', 'Employee'];
export const FR_FUNCTION_ALIASES: readonly string[] = ['Function', 'function'];
export const FR_MANAGER_ALIASES: readonly string[] = [
  'Project Manager',
  'projectManager',
  'Manager',
];
export const FR_EMAIL_ALIASES: readonly string[] = [
  'Project Manager Email',
  'Manager Email',
  'email',
  'Email',
];

export function readCell(row: RowObject, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      const value = row[alias];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LONG = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];
const ALL_MONTHS = [...MONTH_SHORT, ...MONTH_LONG];

export function normalizeForRateMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Rate column = normalized form contains "rate" AND a month/year indicator. Rejects "Rate" alone.
export function isRateColumn(header: string): boolean {
  const n = normalizeForRateMatch(header);
  if (!/\brate\b/.test(n)) return false;
  return (
    ALL_MONTHS.some((m) => n.includes(m)) ||
    /\b(0?[1-9]|1[0-2])\b/.test(n) ||
    /\b(19|20)\d{2}\b/.test(n)
  );
}

export interface RateColumnInfo {
  colIndex: number;
  label: string;
}

// Single-row vs two-row-merge header detection. Merge wins only on strictly higher match count
// (ties prefer single-row to avoid contaminating labels with first-data-row values).
export function detectRateColumns(rawRows: unknown[][], maxHeaderScan = 4): RateColumnInfo[] {
  if (rawRows.length === 0) return [];

  let bestSingle: RateColumnInfo[] = [];
  let bestSingleCount = 0;
  let bestMerged: RateColumnInfo[] = [];
  let bestMergedCount = 0;

  const scanLimit = Math.min(maxHeaderScan, rawRows.length);

  for (let i = 0; i < scanLimit; i++) {
    const row = rawRows[i] ?? [];
    const cols: RateColumnInfo[] = [];
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] ?? '').trim();
      if (isRateColumn(h)) cols.push({ colIndex: c, label: h });
    }
    if (cols.length > bestSingleCount) {
      bestSingleCount = cols.length;
      bestSingle = cols;
    }
  }

  for (let i = 0; i < scanLimit - 1 && i + 1 < rawRows.length; i++) {
    const rowI = rawRows[i] ?? [];
    const rowI1 = rawRows[i + 1] ?? [];
    const cols: RateColumnInfo[] = [];
    for (let c = 0; c < rowI.length; c++) {
      const top = String(rowI[c] ?? '').trim();
      const bottom = String(rowI1[c] ?? '').trim();
      const merged = bottom ? `${top} ${bottom}`.trim() : top;
      if (isRateColumn(merged)) cols.push({ colIndex: c, label: merged });
    }
    if (cols.length > bestMergedCount) {
      bestMergedCount = cols.length;
      bestMerged = cols;
    }
  }

  if (bestMergedCount > bestSingleCount) return bestMerged;
  return bestSingle;
}

// Only exactly-zero numeric cells are flagged; blanks, non-numeric, +/- values all collapse to 'ignore'.
export type RateCellState = 'zero' | 'ignore';

export function classifyRateCell(
  rawRows: unknown[][],
  rowIndex: number,
  colIndex: number,
): RateCellState {
  const val = rawRows[rowIndex]?.[colIndex];
  if (val === null || val === undefined) return 'ignore';
  if (typeof val === 'number') {
    return isFinite(val) && val === 0 ? 'zero' : 'ignore';
  }
  const text = String(val).trim();
  if (text === '') return 'ignore';
  const parsed = Number(text);
  if (!isFinite(parsed)) return 'ignore';
  return parsed === 0 ? 'zero' : 'ignore';
}
