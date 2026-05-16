import type { RowObject } from '../types';

export const OP_PROJECT_NO_ALIASES: readonly string[] = [
  'Project No.',
  'Project No',
  'Project Number',
  'projectNo',
  'Project ID',
];
export const OP_PROJECT_NAME_ALIASES: readonly string[] = [
  'Project',
  'Project Name',
  'projectName',
  'Name',
];
export const OP_STATE_ALIASES: readonly string[] = ['Project State', 'projectState', 'State'];
export const OP_MANAGER_ALIASES: readonly string[] = [
  'Project Manager',
  'projectManager',
  'Manager',
];
export const OP_EMAIL_ALIASES: readonly string[] = [
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

export function normalizeForPdMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// PD column = contains "pd" AND a month/year indicator (short/long month, numeric 01-12, or 4-digit year).
export function isPdColumn(header: string): boolean {
  const n = normalizeForPdMatch(header);
  if (!/\bpd\b/.test(n)) return false;
  return (
    ALL_MONTHS.some((m) => n.includes(m)) ||
    /\b(0?[1-9]|1[0-2])\b/.test(n) ||
    /\b(19|20)\d{2}\b/.test(n)
  );
}

// Column index + display label for a detected PD column. colIndex enables direct lookup by position.
export interface PdColumnInfo {
  colIndex: number;
  label: string;
}

// Scan two strategies (single-row max; consecutive-pair merge) to find PD columns.
// Merge strategy preferred on ties — handles SAP/SAC two-row "Effort PD" / "Mar 31 2026" headers.
export function detectPdColumns(rawRows: unknown[][], maxHeaderScan = 3): PdColumnInfo[] {
  if (rawRows.length === 0) return [];

  let bestSingleRow: PdColumnInfo[] = [];
  let bestSingleCount = 0;
  let bestMerged: PdColumnInfo[] = [];
  let bestMergedCount = 0;

  const scanLimit = Math.min(maxHeaderScan, rawRows.length);

  for (let i = 0; i < scanLimit; i++) {
    const row = rawRows[i] ?? [];
    const cols: PdColumnInfo[] = [];
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] ?? '').trim();
      if (isPdColumn(h)) cols.push({ colIndex: c, label: h });
    }
    if (cols.length > bestSingleCount) {
      bestSingleCount = cols.length;
      bestSingleRow = cols;
    }
  }

  for (let i = 0; i < scanLimit - 1 && i + 1 < rawRows.length; i++) {
    const rowI = rawRows[i] ?? [];
    const rowI1 = rawRows[i + 1] ?? [];
    const cols: PdColumnInfo[] = [];
    for (let c = 0; c < rowI.length; c++) {
      const top = String(rowI[c] ?? '').trim();
      const bottom = String(rowI1[c] ?? '').trim();
      const merged = bottom ? `${top} ${bottom}`.trim() : top;
      if (isPdColumn(merged)) cols.push({ colIndex: c, label: merged });
    }
    if (cols.length > bestMergedCount) {
      bestMergedCount = cols.length;
      bestMerged = cols;
    }
  }

  // Prefer Strategy B on ties: produces unique month labels vs repeated generic ones.
  if (bestMergedCount >= bestSingleCount && bestMergedCount > 0) {
    return bestMerged;
  }
  return bestSingleRow;
}

// Read manager name with First Name + Last Name fallback for split-column files.
export function readManagerName(row: RowObject): string {
  const mgr = readCell(row, OP_MANAGER_ALIASES);
  if (mgr !== undefined && String(mgr).trim()) return String(mgr).trim();
  const first = String(readCell(row, ['First Name', 'firstName']) ?? '').trim();
  const last = String(readCell(row, ['Last Name', 'lastName']) ?? '').trim();
  return [first, last].filter(Boolean).join(' ');
}

export function readPdValue(row: RowObject, columnName: string): number | null {
  const raw = row[columnName];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : null;
}
