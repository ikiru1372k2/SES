import type { RowObject } from '../types';

export const ICR_PROJECT_NO_ALIASES: readonly string[] = [
  'Project ID',
  'Project No.',
  'Project No',
  'Project Number',
  'projectNo',
];
export const ICR_PROJECT_NAME_ALIASES: readonly string[] = [
  'Project Name',
  'Project',
  'projectName',
  'Name',
];
export const ICR_EMPLOYEE_ALIASES: readonly string[] = [
  'Employee Name',
  'employeeName',
  'Employee',
];
export const ICR_FUNCTION_ALIASES: readonly string[] = ['Function', 'function'];
export const ICR_MANAGER_ALIASES: readonly string[] = [
  'Project Manager',
  'projectManager',
  'Manager',
];
export const ICR_EMAIL_ALIASES: readonly string[] = [
  'Project Manager Email',
  'Manager Email',
  'email',
  'Email',
];
export const ICR_COST_RATE_ALIASES: readonly string[] = [
  'Cost Rate',
  'costRate',
  'Internal Cost Rate',
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

const MONTH_SHORT = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];
const MONTH_LONG = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];
const ALL_MONTHS = [...MONTH_SHORT, ...MONTH_LONG];

export function normalizeForIcrMonthMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Monthly cost-rate column = normalized form contains a month token AND a 4-digit year.
export function isCostRateMonthColumn(header: string): boolean {
  const n = normalizeForIcrMonthMatch(header);
  if (!/\b(19|20)\d{2}\b/.test(n)) return false;
  return ALL_MONTHS.some((m) => new RegExp(`\\b${m}\\b`).test(n));
}

export interface CostRateColumnInfo {
  colIndex: number;
  label: string;
}

// Mirrors function-rate detectRateColumns: single-row vs two-row merge; merge wins only on strictly higher count.
export function detectCostRateColumns(
  rawRows: unknown[][],
  maxHeaderScan = 4,
): CostRateColumnInfo[] {
  if (rawRows.length === 0) return [];

  let bestSingle: CostRateColumnInfo[] = [];
  let bestSingleCount = 0;
  let bestMerged: CostRateColumnInfo[] = [];
  let bestMergedCount = 0;

  const scanLimit = Math.min(maxHeaderScan, rawRows.length);

  for (let i = 0; i < scanLimit; i++) {
    const row = rawRows[i] ?? [];
    const cols: CostRateColumnInfo[] = [];
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] ?? '').trim();
      if (isCostRateMonthColumn(h)) cols.push({ colIndex: c, label: h });
    }
    if (cols.length > bestSingleCount) {
      bestSingleCount = cols.length;
      bestSingle = cols;
    }
  }

  for (let i = 0; i < scanLimit - 1 && i + 1 < rawRows.length; i++) {
    const rowI = rawRows[i] ?? [];
    const rowI1 = rawRows[i + 1] ?? [];
    const width = Math.max(rowI.length, rowI1.length);
    const cols: CostRateColumnInfo[] = [];
    for (let c = 0; c < width; c++) {
      const top = String(rowI[c] ?? '').trim();
      const bottom = String(rowI1[c] ?? '').trim();
      const merged = bottom ? `${top} ${bottom}`.trim() : top;
      if (isCostRateMonthColumn(merged)) cols.push({ colIndex: c, label: merged });
    }
    if (cols.length > bestMergedCount) {
      bestMergedCount = cols.length;
      bestMerged = cols;
    }
  }

  if (bestMergedCount > bestSingleCount) return bestMerged;
  return bestSingle;
}

// Only exactly-zero numeric cells flag; everything else (blank, NaN, +/-) collapses to 'ignore'. -0 flags (-0 === 0).
export type CostRateCellState = 'zero' | 'ignore';

export function classifyCostRateCell(
  rawRows: unknown[][],
  rowIndex: number,
  colIndex: number,
): CostRateCellState {
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
