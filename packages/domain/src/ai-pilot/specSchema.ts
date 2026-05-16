import type { AiRuleNode, AiRuleSpec } from './types';
import { OPERATORS } from './operators';

const SEVERITIES = ['High', 'Medium', 'Low'] as const;
const CATEGORIES = [
  'Overplanning',
  'Missing Planning',
  'Function Rate',
  'Internal Cost Rate',
  'Other',
  'Effort Threshold',
  'Missing Data',
  'Planning Risk',
  'Capacity Risk',
  'Data Quality',
  'Needs Review',
] as const;
const VALID_OPS = new Set([...Object.keys(OPERATORS), 'and', 'or']);
const MAX_DEPTH = 2;

export type SpecValidationResult =
  | { ok: true; spec: AiRuleSpec }
  | { ok: false; error: string };

export function validateSpec(input: unknown): SpecValidationResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'spec must be an object' };
  const s = input as Record<string, unknown>;
  // ruleCode: any string; service rewrites it to ai_<ulid> before persisting.
  if (typeof s.ruleCode !== 'string' || !s.ruleCode.trim()) {
    return { ok: false, error: 'ruleCode required' };
  }
  if (typeof s.functionId !== 'string') return { ok: false, error: 'functionId required' };
  if (typeof s.name !== 'string' || !s.name.trim()) return { ok: false, error: 'name required' };
  if (typeof s.flagMessage !== 'string') return { ok: false, error: 'flagMessage required' };
  // ruleVersion: service defaults to 1 if missing/wrong.
  if (s.ruleVersion !== undefined && (typeof s.ruleVersion !== 'number' || s.ruleVersion < 1)) {
    return { ok: false, error: 'ruleVersion must be a positive integer if provided' };
  }
  if (!SEVERITIES.includes(s.severity as (typeof SEVERITIES)[number])) {
    return { ok: false, error: `severity must be one of ${SEVERITIES.join(', ')}` };
  }
  if (!CATEGORIES.includes(s.category as (typeof CATEGORIES)[number])) {
    return { ok: false, error: `category must be one of ${CATEGORIES.join(', ')}` };
  }
  // Normalize: default `op` to 'and' when only children present; rename `operator` → `op`.
  const normalizedLogic = normalizeLogic(s.logic);
  const logicError = validateNode(normalizedLogic, 0);
  if (logicError) return { ok: false, error: `logic: ${logicError}` };
  return { ok: true, spec: { ...(input as AiRuleSpec), logic: normalizedLogic } };
}

function normalizeLogic(node: unknown): AiRuleNode {
  if (!node || typeof node !== 'object') return node as AiRuleNode;
  const n = { ...(node as Record<string, unknown>) };
  // Some LLMs use "operator" instead of "op".
  if (typeof n.operator === 'string' && typeof n.op !== 'string') {
    n.op = n.operator;
    delete n.operator;
  }
  if (Array.isArray(n.children) && typeof n.op !== 'string') {
    n.op = 'and';
  }
  if (Array.isArray(n.children)) {
    n.children = (n.children as unknown[]).map(normalizeLogic);
  }
  // Coerce isOneOf `value` → `values[]`.
  if (n.op === 'isOneOf' && n.value !== undefined && n.values === undefined) {
    n.values = Array.isArray(n.value) ? n.value : [n.value];
    delete n.value;
  }
  return n as AiRuleNode;
}

function validateNode(node: unknown, depth: number): string | null {
  if (depth > MAX_DEPTH) return `nesting depth exceeds ${MAX_DEPTH}`;
  if (!node || typeof node !== 'object') return 'node must be an object';
  const n = node as Record<string, unknown>;
  if (typeof n.op !== 'string' || !VALID_OPS.has(n.op)) return `unknown op '${String(n.op)}'`;
  if (n.op === 'and' || n.op === 'or') {
    if (!Array.isArray(n.children) || n.children.length === 0) return 'children required';
    for (const child of n.children) {
      const e = validateNode(child, depth + 1);
      if (e) return e;
    }
    return null;
  }
  if (typeof n.column !== 'string' || !n.column.trim()) return 'column required';
  if (n.op === 'isOneOf' && !Array.isArray(n.values)) return 'values[] required for isOneOf';
  if (n.op === '%>' && typeof n.compareTo !== 'string') return 'compareTo required for %>';
  return null;
}
