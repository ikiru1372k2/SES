import type { RowObject } from '../types';

// Authoritative header strings for the Opportunities CRM export. Flat workbook; single literal-match pass.

export const OPP_PROJECT_NO_ALIASES: readonly string[] = [
  'OPP_ID',
  'Opportunity ID',
  'Opp ID',
  'projectNo',
];
export const OPP_NAME_ALIASES: readonly string[] = [
  'Opportunity',
  'Opportunity Name',
  'projectName',
];
export const OPP_COUNTRY_ALIASES: readonly string[] = ['Country', 'country'];
export const OPP_PROBABILITY_ALIASES: readonly string[] = [
  'Probability',
  'probability',
  'Prob',
];
export const OPP_CATEGORY_ALIASES: readonly string[] = ['Category', 'category'];
export const OPP_BUSINESS_UNIT_ALIASES: readonly string[] = [
  'Business Unit',
  'businessUnit',
  'BU',
];
export const OPP_BCS_FLAG_ALIASES: readonly string[] = [
  'BCS_FLAG',
  'BCS Flag',
  'bcsFlag',
];
export const OPP_PRJ_START_PAST_ALIASES: readonly string[] = [
  'PRJ_START_IN_PAST',
  'Project Start In Past',
];
export const OPP_CLS_DATE_PAST_ALIASES: readonly string[] = [
  'CLS_DATE_IN_PAST',
  'Close Date In Past',
];
export const OPP_CLS_DATE_ALIASES: readonly string[] = ['CLS_DATE', 'Close Date'];
// Opportunity Owner = project manager for escalation routing; email is filled later by the Manager Directory resolver.
export const OPP_OWNER_ALIASES: readonly string[] = [
  'Opportunity Owner',
  'opportunity owner',
  'OpportunityOwner',
  'Owner',
  'owner',
];

// Direct lookup, then trim-fallback for trailing-space headers seen in real exports.
export function readCell(row: RowObject, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      const value = row[alias];
      if (value !== undefined) return value;
    }
  }
  const wantedTrimmed = aliases.map((a) => a.trim());
  for (const key of Object.keys(row)) {
    const trimmedKey = key.trim();
    if (wantedTrimmed.includes(trimmedKey)) {
      const value = row[key];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

// Accepts 0/1 numerics, 'true'/'1' strings (case-insensitive, trimmed); everything else falsy.
export function readBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed === 'true' || trimmed === '1';
  }
  return false;
}

// Tolerant numeric parse so '90', 90, 90.0, '90 ' all collapse to 90.
export function readNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

// Per locked decision: BCS is "missing" ONLY when the cell trims to '#'; everything else is present.
export function isBcsMissing(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() === '#';
}

export function isBcsBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return String(value).trim() === '';
}

export function readText(row: RowObject, aliases: readonly string[]): string {
  const raw = readCell(row, aliases);
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}
