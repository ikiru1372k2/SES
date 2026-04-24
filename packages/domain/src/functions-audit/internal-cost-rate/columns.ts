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

// A column is a monthly cost-rate column if its normalized form contains a
// month token AND a 4-digit year. Accepts "Jan 31, 2026", "Feb 28 2026",
// "January 2026", "2026 January", "Jan-2026". Rejects bare month ("Jan"),
// bare year ("2026"), "Cost Rate" (no year/month), "Function", "Project ID".
export function isCostRateMonthColumn(header: string): boolean {
  const n = normalizeForIcrMonthMatch(header);
  if (!/\b(19|20)\d{2}\b/.test(n)) return false;
  return ALL_MONTHS.some((m) => new RegExp(`\\b${m}\\b`).test(n));
}

export interface CostRateColumnInfo {
  colIndex: number;
  label: string;
}

// Two-strategy header detection, mirroring function-rate's detectRateColumns:
//   A: single-row scan — pick the header row with the most matches.
//   B: two-row merge — for pairs (i, i+1), concatenate cells column-by-column
//      and check the merged label. Handles the real ICR sample's layout where
//      row[0]="Effort Month" (banner) and row[1]="Jan 31, 2026" (period).
// Strategy B wins ONLY on strict count — on ties we prefer A because merging
// with a data row (one-row-header files) would contaminate labels with
// numeric cost values.
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

// Only exactly-zero cells are flagged. Blanks, non-numeric text, positive and
// negative values all collapse to 'ignore'. "0", "0.0", "  0  " all parse to
// 0 and count as 'zero'; "n/a", "TBD", "", null, 125, -5 all classify as
// 'ignore'. JS numeric -0 flags because -0 === 0. Formula cells evaluated
// to 0 also flag (the parser delivers the cached computed value).
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
