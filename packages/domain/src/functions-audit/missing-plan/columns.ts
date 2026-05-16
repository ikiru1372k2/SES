// Authoritative column-name list for Missing Plan. Aliases cover effort-column spelling variations.

import type { RowObject } from '../types';

export interface ColumnSpec {
  id: string;
  label: string;
  aliases: string[];
}

export const MP_EFFORT_ALIASES: readonly string[] = [
  'Effort (H)',
  'Effort(H)',
  'effort(h)',
  'effort (h)',
  'Effort H',
  'effort h',
  'Effort h',
  'EFFORT (H)',
  'EFFORT(H)',
  'EFFORT H',
  'Effort',
  'effort',
  'EFFORT',
  'Hours',
  'hours',
  'HOURS',
  'Planned Effort',
  'planned effort',
  'PLANNED EFFORT',
  'Measures Effort',
  'measures effort',
];

// Identifier aliases mirror workbook.ts COLUMN_ALIASES and the master-data engine for consistent finding metadata.
export const MP_PROJECT_NO_ALIASES: readonly string[] = [
  'Project No.',
  'Project No',
  'Project Number',
  'projectNo',
  'Project ID',
];
export const MP_PROJECT_NAME_ALIASES: readonly string[] = [
  'Project',
  'Project Name',
  'projectName',
  'Name',
];
export const MP_STATE_ALIASES: readonly string[] = [
  'Project State',
  'projectState',
  'State',
];
export const MP_MANAGER_ALIASES: readonly string[] = [
  'Project Manager',
  'projectManager',
  'Manager',
];
export const MP_EMAIL_ALIASES: readonly string[] = [
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

// Returns numeric effort or null if absent/blank/non-finite. Callers must check `=== 0` to detect zero-effort.
export function readEffortValue(row: RowObject, aliases: readonly string[]): number | null {
  const raw = readCell(row, aliases);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : null;
}
