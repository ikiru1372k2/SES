import { isValidEmail, sanitizeHeader } from '../notifications/notificationBuilder';

export type DirectoryColumnRole = 'firstName' | 'lastName' | 'email' | 'teamsUsername';

export type DetectedColumnMapping = Partial<Record<DirectoryColumnRole, string>>;

export type ParsedTsv = {
  headers: string[];
  rows: Record<string, string>[];
};

const FIRST_KEYS = new Set([
  'firstname',
  'fname',
  'givenname',
  'given',
  'first',
  'forename',
]);

const LAST_KEYS = new Set(['lastname', 'lname', 'surname', 'familyname', 'last', 'secondname']);

const EMAIL_KEYS = new Set(['email', 'emailaddress', 'mail', 'e-mail', 'workemail']);

const TEAMS_KEYS = new Set([
  'teamsusername',
  'teams',
  'teamsuser',
  'teamsid',
  'teamshandle',
  'teamsupn',
  'upn',
]);

function stripCombiningMarks(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Lowercase, strip accents, keep alphanumerics as tokens. */
export function normalizeNamePart(value: string): string {
  const stripped = stripCombiningMarks(value.trim().toLowerCase());
  return stripped.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenizeForSort(value: string): string[] {
  const n = normalizeNamePart(value);
  if (!n) return [];
  return n.split(' ').filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/**
 * Deterministic key for first+last (token-sorted) for directory matching.
 */
export function normalizeManagerKey(firstName: string, lastName: string): string {
  const parts = [...tokenizeForSort(firstName), ...tokenizeForSort(lastName)].sort((a, b) => a.localeCompare(b));
  return parts.join(' ');
}

export function normalizeObservedManagerLabel(observed: string): string {
  const parts = tokenizeForSort(observed);
  return parts.join(' ');
}

function normalizeHeaderKey(header: string): string {
  return stripCombiningMarks(header)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function classifyHeader(header: string): DirectoryColumnRole | null {
  const key = normalizeHeaderKey(header);
  if (!key) return null;
  if (TEAMS_KEYS.has(key) || key.startsWith('teams')) return 'teamsUsername';
  if (EMAIL_KEYS.has(key) || key.endsWith('email')) return 'email';
  if (FIRST_KEYS.has(key) || key.startsWith('first') || key.includes('givenname')) return 'firstName';
  if (LAST_KEYS.has(key) || key.startsWith('last') || key.includes('surname') || key.includes('familyname'))
    return 'lastName';
  return null;
}

/**
 * Maps each logical role to the **original** header string from the first row.
 */
export function detectColumnMapping(headers: string[]): DetectedColumnMapping {
  const mapping: DetectedColumnMapping = {};
  for (const raw of headers) {
    const role = classifyHeader(raw);
    if (!role || mapping[role] !== undefined) continue;
    mapping[role] = raw.trim();
  }
  return mapping;
}

export function parseTsvRows(text: string): ParsedTsv {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.map((l) => l.replace(/\u00a0/g, ' ')).filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = nonEmpty[0]!.split('\t').map((c) => c.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = nonEmpty[i]!.split('\t');
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] ?? `col_${c}`;
      row[key] = (cells[c] ?? '').trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

export type DirectoryMatchRow = {
  id: string;
  normalizedKey: string;
  aliases: string[];
  active: boolean;
};

export type DirectoryExactMatchReason = 'normalizedKey' | 'alias';

export type DirectoryExactMatch =
  | { kind: 'hit'; entryId: string; reason: DirectoryExactMatchReason }
  | { kind: 'collision'; entryIds: string[]; reason: 'duplicate_normalizedKey' | 'duplicate_alias' }
  | { kind: 'miss' };

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function matchDirectoryExact(
  observedNormalized: string,
  entries: DirectoryMatchRow[],
): DirectoryExactMatch {
  const active = entries.filter((e) => e.active);
  const byNorm = active.filter((e) => e.normalizedKey === observedNormalized);
  if (byNorm.length > 1) {
    return { kind: 'collision', entryIds: byNorm.map((e) => e.id), reason: 'duplicate_normalizedKey' };
  }
  if (byNorm.length === 1) {
    return { kind: 'hit', entryId: byNorm[0]!.id, reason: 'normalizedKey' };
  }
  const aliasHits: string[] = [];
  for (const e of active) {
    for (const a of e.aliases) {
      if (normalizeObservedManagerLabel(a) === observedNormalized) {
        aliasHits.push(e.id);
        break;
      }
    }
  }
  const uniq = uniqueIds(aliasHits);
  if (uniq.length > 1) return { kind: 'collision', entryIds: uniq, reason: 'duplicate_alias' };
  if (uniq.length === 1) return { kind: 'hit', entryId: uniq[0]!, reason: 'alias' };
  return { kind: 'miss' };
}

export function activeEntriesShareNormalizedKey(entries: DirectoryMatchRow[]): boolean {
  const active = entries.filter((e) => e.active);
  const keys = new Map<string, number>();
  for (const e of active) {
    keys.set(e.normalizedKey, (keys.get(e.normalizedKey) ?? 0) + 1);
  }
  return [...keys.values()].some((c) => c > 1);
}

export type DirectoryRowInput = {
  firstName: string;
  lastName: string;
  email: string;
  teamsUsername?: string;
};

export type DirectoryRowIssue =
  | 'invalid_email'
  | 'duplicate_email_in_batch'
  | 'missing_first_name'
  | 'missing_last_name'
  | 'missing_email';

export type DirectoryRowValidation = {
  rowIndex: number;
  input: DirectoryRowInput;
  issues: DirectoryRowIssue[];
};

export function validateDirectoryRows(rows: DirectoryRowInput[]): DirectoryRowValidation[] {
  const emailCount = new Map<string, number>();
  for (const row of rows) {
    const e = sanitizeHeader(row.email).toLowerCase();
    if (!e) continue;
    emailCount.set(e, (emailCount.get(e) ?? 0) + 1);
  }
  return rows.map((input, rowIndex) => {
    const issues: DirectoryRowIssue[] = [];
    const fn = sanitizeHeader(input.firstName).trim();
    const ln = sanitizeHeader(input.lastName).trim();
    const em = sanitizeHeader(input.email).trim();
    const tu = sanitizeHeader(input.teamsUsername ?? '').trim();
    if (!fn) issues.push('missing_first_name');
    if (!ln) issues.push('missing_last_name');
    if (!em) issues.push('missing_email');
    else if (!isValidEmail(em)) issues.push('invalid_email');
    const lower = em.toLowerCase();
    if (em && isValidEmail(em) && (emailCount.get(lower) ?? 0) > 1) {
      issues.push('duplicate_email_in_batch');
    }
    return { rowIndex, input: { firstName: fn, lastName: ln, email: em, teamsUsername: tu }, issues };
  });
}

export const normalizedDirectoryKey = normalizeManagerKey;
