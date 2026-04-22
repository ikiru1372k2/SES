// Shared primitive: decide if a cell value is effectively blank or a
// placeholder. Used by every function-specific engine — keeping it here
// means that adding a new placeholder token fixes every function at once.

export const BAD_VALUE_TOKENS: readonly string[] = [
  '',
  '-',
  '--',
  'n/a',
  'na',
  'null',
  'none',
  'nil',
  'tbd',
  'pending',
  'undefined',
  'unknown',
  '?',
  'not assigned',
  'not available',
  'not available yet',
  'not avaliable yet',
  'missing',
  'not applicable',
  'not set',
];

const BAD_VALUE_SET = new Set(BAD_VALUE_TOKENS);

export function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

export function isBadValue(value: unknown): boolean {
  return BAD_VALUE_SET.has(normalizeCell(value));
}

// Project Product has a special rule: the literal tokens "Other" / "Others"
// are not invalid — they mean "the importer didn't know which product to
// pick", which is a human-review situation, not a missing-data defect.
const OTHERS_TOKENS = new Set(['other', 'others']);

export function isOthersToken(value: unknown): boolean {
  return OTHERS_TOKENS.has(normalizeCell(value));
}

// "Not assigned" is also a Project Product manual-review token. The user
// explicitly typed it instead of leaving the cell blank, so it's distinct
// from a generic missing-field finding — the auditor needs to follow up
// and pick a real product. Other columns still treat 'not assigned' as a
// bad value (see BAD_VALUE_TOKENS); this helper is only consumed by the
// Project Product engine path.
const NOT_ASSIGNED_TOKENS = new Set(['not assigned']);

export function isNotAssignedToken(value: unknown): boolean {
  return NOT_ASSIGNED_TOKENS.has(normalizeCell(value));
}