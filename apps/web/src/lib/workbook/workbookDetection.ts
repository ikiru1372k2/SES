const COLUMN_ALIASES: Record<string, string[]> = {
  country: ['country'],
  businessUnit: ['business unit', 'business unit project', 'unit'],
  customer: ['customer', 'customer name'],
  projectNo: ['project no', 'project no.', 'project number', 'project id', 'opp_id', 'opportunity id'],
  projectName: ['project', 'project name', 'name', 'opportunity'],
  projectState: ['project state', 'state'],
  countryManager: ['project country manager', 'country manager'],
  projectManager: ['project manager', 'manager'],
  email: ['email', 'manager email', 'project manager email'],
  effort: ['effort', 'hours', 'effort h', 'effort (h)', 'planned effort'],
  status: ['status', 'audit status'],
  probability: ['probability', 'prob'],
  category: ['category'],
};

const TEMPLATE_PROFILES = [
  {
    minScore: 4,
    requiredColumns: ['projectNo'],
    weightedColumns: ['projectNo', 'projectManager', 'projectState', 'effort'],
  },
  {
    minScore: 4,
    requiredColumns: ['projectNo', 'projectName', 'country', 'probability'],
    weightedColumns: ['projectNo', 'projectName', 'country', 'probability', 'category', 'businessUnit'],
  },
] as const;

export type HeaderCandidate = {
  headerRowIndex: number;
  originalHeaders: string[];
  normalizedHeaders: string[];
  score: number;
  matchedColumns: Set<string>;
};

export function normalizeHeaderLabel(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, (match) => ` ${match.slice(1, -1)} `)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalHeader(value: unknown): string | null {
  const normalized = normalizeHeaderLabel(value);
  if (!normalized) return null;
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((alias) => normalized === normalizeHeaderLabel(alias))) return canonical;
  }
  return null;
}

export function rowHeaderScore(row: unknown[]): Omit<HeaderCandidate, 'headerRowIndex'> {
  const originalHeaders = row.map((cell) => String(cell ?? '').trim());
  const normalizedHeaders = originalHeaders.map((cell, index) => canonicalHeader(cell) ?? (cell ? `column${index + 1}` : ''));
  const matchedColumns = new Set(normalizedHeaders.filter(Boolean).filter((header) => !header.startsWith('column')));
  const profileScore = TEMPLATE_PROFILES.reduce((best, profile) => {
    const weightedMatches = profile.weightedColumns.filter((column) => matchedColumns.has(column)).length;
    const requiredMatches = profile.requiredColumns.filter((column) => matchedColumns.has(column)).length;
    const score = weightedMatches + requiredMatches * 2;
    return Math.max(best, score);
  }, 0);
  return {
    score: matchedColumns.size + profileScore,
    normalizedHeaders,
    originalHeaders,
    matchedColumns,
  };
}

export function detectHeader(rows: unknown[][], scanLimit: number): HeaderCandidate | null {
  let best: HeaderCandidate | null = null;
  const scanLength = Math.min(rows.length, scanLimit);
  for (let index = 0; index < scanLength; index += 1) {
    const row = rows[index] ?? [];
    const candidate = rowHeaderScore(row);
    if (!best || candidate.score > best.score) best = { ...candidate, headerRowIndex: index };
  }
  const matchesProfile = best && TEMPLATE_PROFILES.some((profile) =>
    best.score >= profile.minScore && profile.requiredColumns.every((column) => best.matchedColumns.has(column)),
  );
  if (!best || !matchesProfile) return null;
  return best;
}
