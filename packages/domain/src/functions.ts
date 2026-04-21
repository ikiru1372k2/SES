export const FUNCTION_REGISTRY = [
  { id: 'master-data', label: 'Master Data', displayOrder: 1 },
  { id: 'over-planning', label: 'Over Planning', displayOrder: 2 },
  { id: 'missing-plan', label: 'Missing Plan', displayOrder: 3 },
  { id: 'function-rate', label: 'Function Rate', displayOrder: 4 },
  { id: 'internal-cost-rate', label: 'Internal Cost Rate', displayOrder: 5 },
] as const;

export type FunctionId = (typeof FUNCTION_REGISTRY)[number]['id'];

export const FUNCTION_IDS: readonly FunctionId[] = FUNCTION_REGISTRY.map((f) => f.id);

export function isFunctionId(value: unknown): value is FunctionId {
  return typeof value === 'string' && FUNCTION_IDS.includes(value as FunctionId);
}

export function getFunctionLabel(id: FunctionId): string {
  return FUNCTION_REGISTRY.find((f) => f.id === id)?.label ?? id;
}

export const DEFAULT_FUNCTION_ID: FunctionId = 'master-data';
