export const FUNCTION_REGISTRY = [
  { id: 'master-data', label: 'Master Data', displayOrder: 1 },
  { id: 'over-planning', label: 'Over Planning', displayOrder: 2 },
  { id: 'missing-plan', label: 'Missing Plan', displayOrder: 3 },
  { id: 'function-rate', label: 'Function Rate', displayOrder: 4 },
  { id: 'internal-cost-rate', label: 'Internal Cost Rate', displayOrder: 5 },
  { id: 'opportunities', label: 'Opportunities', displayOrder: 6 },
] as const;

export type FunctionId = (typeof FUNCTION_REGISTRY)[number]['id'];

export const FUNCTION_IDS: readonly FunctionId[] = FUNCTION_REGISTRY.map((f) => f.id);

export function isFunctionId(value: unknown): value is FunctionId {
  return typeof value === 'string' && FUNCTION_IDS.includes(value as FunctionId);
}

export function getFunctionLabel(id: FunctionId): string {
  return FUNCTION_REGISTRY.find((f) => f.id === id)?.label ?? id;
}

/**
 * One-line summary of what each function's audit actually checks, derived
 * from that function's rule set (packages/domain/src/functions-audit/<fn>/
 * rules.ts). Shown in the Audit Results header before a run so the line is
 * relevant to the function the user is in — instead of the shared
 * Over-Planning QGC policy text.
 *
 * `over-planning` returns null on purpose: its thresholds are configurable
 * per process via `auditPolicy`, so callers keep the dynamic
 * `policySummary(process.auditPolicy)` for it. `master-data` also returns
 * null — it has its own descriptive copy in the Audit Results header.
 */
export function getFunctionPolicySummary(id: FunctionId): string | null {
  switch (id) {
    case 'function-rate':
      return 'Flags monthly External Rate columns that are exactly 0 (resource not priced). Blank rate cells are ignored.';
    case 'internal-cost-rate':
      return 'Flags monthly Internal Cost Rate columns that are exactly 0 (resource not costed). Blank cells are ignored.';
    case 'missing-plan':
      return 'Flags projects with no Effort (H) recorded (not planned) or Effort (H) = 0 (missing/deferred planning).';
    case 'opportunities':
      return 'Checks opportunities for past close/start dates, low win probability, and missing or !-flagged BCS codes.';
    case 'over-planning':
    case 'master-data':
      return null; // caller uses dynamic policy / its own descriptive copy
    default:
      return null;
  }
}

export const DEFAULT_FUNCTION_ID: FunctionId = 'master-data';
