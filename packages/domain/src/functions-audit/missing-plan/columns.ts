// Authoritative column-name list for the Missing Plan function. Aliases
// cover every common variation of "Effort (H)" seen in effort-tracking
// exports so the engine works regardless of whitespace, casing, or whether
// the unit suffix is parenthesised.
//
// Identifier-only columns (project no, name, state, manager, email) are
// NOT audited — they're read solely to populate issue metadata, matching
// the same pattern used by the master-data engine.

import type { RowObject } from '../types';

export interface ColumnSpec {
  id: string;
  label: string;
  aliases: string[];
}

// All recognised spellings of the effort column. The engine tries each alias
// in order until it finds a match in the row object.
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

// Identifier-only alias arrays. These mirror the aliases used by the
// workbook header detector (workbook.ts COLUMN_ALIASES) and the master-data
// engine so findings carry consistent metadata regardless of which engine
// produced them.
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

// Returns the numeric effort value from the row, or null if the cell is
// absent, blank, or not parseable as a finite number.
// Explicitly returns 0 when the cell is the number 0 or the string "0" /
// "0.0" — callers must check for === 0 to detect the zero-effort condition.
export function readEffortValue(row: RowObject, aliases: readonly string[]): number | null {
  const raw = readCell(row, aliases);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : null;
}
